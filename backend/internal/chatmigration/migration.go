// Package chatmigration coordinates the private operator migration. It never
// authorizes an owner from an archive, reopens a failed run, or uses public import.
package chatmigration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

var (
	ErrInvalid  = errors.New("CHAT_MIGRATION_INVALID")
	ErrArtifact = errors.New("CHAT_MIGRATION_ARTIFACT_INVALID")
	ErrSnapshot = errors.New("CHAT_MIGRATION_SNAPSHOT_FAILED")
	ErrStore    = errors.New("CHAT_MIGRATION_STORE_FAILED")
	ErrDrain    = errors.New("CHAT_MIGRATION_DRAIN_FAILED")
	ErrCleanup  = errors.New("CHAT_MIGRATION_CLEANUP_FAILED")
)

type Store interface {
	FreezeChatMigration(context.Context, int64, string, string, string, int64) (postgres.ChatMigrationRun, error)
	ChatMigrationSupplement(context.Context, int64, string) (postgres.ChatMigrationManifest, error)
	StageChatMigration(context.Context, int64, postgres.ChatMigrationManifest, postgres.ChatMigrationChat, chattransfer.Manifest, chattransfer.Objects) error
	BeginChatTransfer(context.Context, int64) (postgres.ChatTransferIntent, error)
	ReleaseChatTransfer(context.Context, int64, string) error
	VerifyChatMigration(context.Context, int64, postgres.ChatMigrationManifest) error
	ActivateChatMigration(context.Context, int64, string, int64) (int64, error)
	ReverseExportChatMigration(context.Context, int64, string, string, io.Writer) (postgres.ChatMigrationChat, error)
}

type Gate interface {
	FreezeChatAdmission(context.Context, int64, string, string) (stsource.ChatCutoverStatus, error)
	DrainChatHandlers(context.Context, int64, string, string) (stsource.ChatCutoverStatus, error)
}

type Config struct {
	Owner                           int64
	RunID, Direction                string
	ExpectedEpoch                   int64
	STRoot, ArtifactRoot, STBaseURL string
	LatestRightsManifest            string
	AccountHandles                  map[string]string
	CharacterDirectories            map[string]string
	Activate                        bool
}

type Result struct {
	Chats      int64 `json:"chats"`
	Messages   int64 `json:"messages"`
	Candidates int64 `json:"candidates"`
	Activated  bool  `json:"activated"`
}

type Runner struct {
	Store    Store
	Gate     Gate
	Snapshot Snapshotter
	Objects  chattransfer.Objects
}

func (r Runner) Run(ctx context.Context, c Config) (result Result, err error) {
	if r.Store == nil || r.Snapshot == nil || c.Owner <= 0 || !stsource.ValidIdentity(c.RunID) || c.ExpectedEpoch < 1 || c.STRoot == "" || c.ArtifactRoot == "" || (c.Direction != "ST_TO_GO" && c.Direction != "GO_TO_ST") || (c.Direction == "ST_TO_GO" && (r.Gate == nil || r.Objects == nil)) {
		return result, ErrInvalid
	}
	// Canonicalize the operator-controlled parent (macOS /tmp and /var are
	// aliases), while still rejecting a substituted root itself.
	parent, err := filepath.EvalSymlinks(filepath.Dir(c.STRoot))
	if err != nil {
		return result, ErrArtifact
	}
	c.STRoot = filepath.Join(parent, filepath.Base(c.STRoot))
	if c.Direction == "ST_TO_GO" {
		info, err := os.Lstat(c.STRoot)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return result, ErrArtifact
		}
	}
	if c.Direction == "GO_TO_ST" {
		if _, err := os.Lstat(c.STRoot); err == nil {
			if err := ownedClosedRestore(c.STRoot, c, c.ExpectedEpoch+1); err != nil {
				return result, err
			}
		} else if !os.IsNotExist(err) {
			return result, ErrArtifact
		}
	}
	var externalRights []postgres.ChatData
	if c.LatestRightsManifest != "" {
		parent, err := filepath.EvalSymlinks(filepath.Dir(c.LatestRightsManifest))
		if err != nil {
			return result, ErrArtifact
		}
		f, err := openPrivate(parent, filepath.Base(c.LatestRightsManifest))
		if err != nil {
			return result, err
		}
		var latest postgres.ChatMigrationManifest
		d := json.NewDecoder(io.LimitReader(f, maxManifestBytes+1))
		d.UseNumber()
		d.DisallowUnknownFields()
		err = d.Decode(&latest)
		if err == nil {
			if d.Decode(new(any)) != io.EOF {
				err = ErrArtifact
			}
		}
		f.Close()
		if err != nil || latest.FormatVersion != 1 || latest.OwnerAccountID != c.Owner {
			return result, ErrArtifact
		}
		externalRights = latest.DeletionAndSuppressionRecords
	}
	// Only a dedicated private artifact directory is owned/cleaned by this CLI.
	if err := ensureArtifactRoot(c.ArtifactRoot); err != nil {
		return result, err
	}
	c.ArtifactRoot, err = filepath.EvalSymlinks(c.ArtifactRoot)
	if err != nil {
		return result, ErrArtifact
	}
	work, err := os.MkdirTemp(c.ArtifactRoot, ".pending-")
	if err != nil {
		return result, ErrArtifact
	}
	defer func() {
		if os.RemoveAll(work) != nil {
			err = ErrCleanup
		}
	}()
	expectedMode := "ST"
	var restoreWork string
	if c.Direction == "GO_TO_ST" {
		expectedMode = "GO"
	}
	run, err := r.Store.FreezeChatMigration(ctx, c.Owner, c.RunID, c.Direction, expectedMode, c.ExpectedEpoch)
	if err != nil {
		return result, safeStoreError(err)
	}
	if run.RunID != c.RunID || run.Direction != c.Direction || run.FrozenEpoch <= c.ExpectedEpoch {
		return result, ErrStore
	}
	epoch := strconv.FormatInt(run.FrozenEpoch, 10)
	if c.Direction == "ST_TO_GO" {
		if _, err := r.Gate.FreezeChatAdmission(ctx, c.Owner, c.RunID, epoch); err != nil {
			return result, safeDrainError(err)
		}
		status, err := r.Gate.DrainChatHandlers(ctx, c.Owner, c.RunID, epoch)
		if err != nil {
			return result, safeDrainError(err)
		}
		if !status.Closed || !status.Durable || status.State != "DRAINED" || status.ActiveHandlers != 0 || status.OwnerAccountID != strconv.FormatInt(c.Owner, 10) || status.RunID != c.RunID || status.AuthorityEpoch != epoch {
			return result, ErrDrain
		}
	}
	manifest, err := r.Store.ChatMigrationSupplement(ctx, c.Owner, c.RunID)
	if err != nil {
		return result, safeStoreError(err)
	}
	if !matches(manifest, c, run.FrozenEpoch) {
		return result, ErrArtifact
	}
	manifest.DeletionAndSuppressionRecords = append(manifest.DeletionAndSuppressionRecords, externalRights...)
	artifact := filepath.Join(work, "snapshot")
	input := SnapshotInput{Root: c.STRoot, ArtifactRoot: artifact, OwnerAccountID: strconv.FormatInt(c.Owner, 10), MigrationRunID: c.RunID, FrozenAuthorityEpoch: epoch, STBaseURL: c.STBaseURL, AccountHandles: c.AccountHandles, CharacterDirectories: c.CharacterDirectories}
	if c.Direction == "ST_TO_GO" {
		input.SupplementFile = filepath.Join(work, "supplement.json")
		if err := writeJSON(input.SupplementFile, manifest); err != nil {
			return result, err
		}
		if err := r.Snapshot.Run(ctx, "export", input); err != nil {
			return result, err
		}
	} else {
		if err := r.reverseExport(ctx, c, manifest, artifact); err != nil {
			return result, err
		}
	}
	manifest, digest, err := readManifest(artifact)
	if err != nil || !matches(manifest, c, run.FrozenEpoch) {
		return result, ErrArtifact
	}
	for _, chat := range manifest.Chats {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		f, err := checkedChat(artifact, chat)
		if err != nil {
			return result, err
		}
		if c.Direction == "ST_TO_GO" {
			err = r.stage(ctx, c.Owner, manifest, chat, f)
		}
		if f != nil {
			f.Close()
		}
		if err != nil {
			return result, err
		}
		result.Chats++
		result.Messages += chat.MessageCount
		result.Candidates += chat.CandidateCount
	}
	if c.Direction == "GO_TO_ST" {
		// Freshly generated here; there is no option to load an attestation or an
		// earlier archive from disk and label it current.
		input.CurrentGoExport = &CurrentGoExport{c.RunID, strconv.FormatInt(c.Owner, 10), epoch, digest}
		restoreWork, err = os.MkdirTemp(filepath.Dir(c.STRoot), ".vc-chat-restore-")
		if err != nil {
			return result, ErrArtifact
		}
		defer func() {
			if os.RemoveAll(restoreWork) != nil {
				err = ErrCleanup
			}
		}()
		input.Root = filepath.Join(restoreWork, "isolated-root")
		if err := r.Snapshot.Run(ctx, "restore", input); err != nil {
			return result, err
		}
	}
	if err := r.Store.VerifyChatMigration(ctx, c.Owner, manifest); err != nil {
		return result, safeStoreError(err)
	}
	if err := publishCurrent(c.ArtifactRoot, artifact, c.Owner); err != nil {
		return result, err
	}
	if c.Direction == "GO_TO_ST" {
		// The target becomes a retained, closed restore root only after the
		// current Go state and complete rights have passed verification.
		previousRoot := ""
		if _, err := os.Lstat(c.STRoot); err == nil {
			if err := ownedClosedRestore(c.STRoot, c, run.FrozenEpoch); err != nil {
				return result, err
			}
			previousRoot = filepath.Join(restoreWork, "previous-root")
			if err := os.Rename(c.STRoot, previousRoot); err != nil {
				return result, ErrArtifact
			}
		} else if !os.IsNotExist(err) {
			return result, ErrArtifact
		}
		if err := os.Mkdir(c.STRoot, 0700); err != nil {
			if previousRoot != "" {
				_ = os.Rename(previousRoot, c.STRoot)
			}
			return result, ErrArtifact
		}
		// os.Rename deliberately refuses an existing directory; the Unix
		// rename primitive replaces our own empty no-clobber reservation.
		if err := syscall.Rename(input.Root, c.STRoot); err != nil {
			_ = os.Remove(c.STRoot) // Only our still-empty reservation.
			if previousRoot != "" {
				_ = os.Rename(previousRoot, c.STRoot)
			}
			return result, ErrArtifact
		}
		input.Root = c.STRoot
	}
	if c.Activate {
		activatedEpoch, err := r.Store.ActivateChatMigration(ctx, c.Owner, c.RunID, run.FrozenEpoch)
		if err != nil {
			return result, safeStoreError(err)
		}
		if activatedEpoch != run.FrozenEpoch+1 {
			return result, ErrStore
		}
		result.Activated = true
		if c.Direction == "GO_TO_ST" {
			input.ArtifactRoot = filepath.Join(c.ArtifactRoot, "current")
			input.ActivatedAuthorityEpoch = strconv.FormatInt(activatedEpoch, 10)
			if err := r.Snapshot.Run(ctx, "finalize", input); err != nil {
				return result, err
			}
		}
	}
	return result, nil
}

func ownedClosedRestore(root string, c Config, epoch int64) error {
	f, err := openPrivate(root, ".vc-f2/chat-cutover.json")
	if err != nil {
		return err
	}
	var marker struct {
		Version int    `json:"version"`
		Owner   string `json:"ownerAccountId"`
		Closed  bool   `json:"closed"`
		Run     string `json:"runId"`
		Epoch   string `json:"epoch"`
	}
	d := json.NewDecoder(io.LimitReader(f, 4096))
	d.DisallowUnknownFields()
	err = d.Decode(&marker)
	if err == nil && d.Decode(new(any)) != io.EOF {
		err = ErrArtifact
	}
	f.Close()
	if err != nil || marker.Version != 1 || !marker.Closed || marker.Owner != strconv.FormatInt(c.Owner, 10) || marker.Run != c.RunID || marker.Epoch != strconv.FormatInt(epoch, 10) {
		return ErrArtifact
	}
	f, err = openPrivate(root, ".vc-f2/migration-manifest.archive")
	if err != nil {
		return err
	}
	defer f.Close()
	var archived postgres.ChatMigrationManifest
	d = json.NewDecoder(io.LimitReader(f, maxManifestBytes+1))
	d.DisallowUnknownFields()
	d.UseNumber()
	if d.Decode(&archived) != nil || d.Decode(new(any)) != io.EOF || !matches(archived, c, epoch) {
		return ErrArtifact
	}
	return nil
}

func (r Runner) stage(ctx context.Context, owner int64, m postgres.ChatMigrationManifest, chat postgres.ChatMigrationChat, src *os.File) (err error) {
	if src == nil {
		return safeStoreError(r.Store.StageChatMigration(ctx, owner, m, chat, chattransfer.Manifest{}, r.Objects))
	}
	intent, err := r.Store.BeginChatTransfer(ctx, owner)
	if err != nil {
		return safeStoreError(err)
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// Release is durable even when object deletion is unavailable. Existing
		// bounded worker GC owns the remaining interrupted-upload intent.
		releaseErr := r.Store.ReleaseChatTransfer(cleanupCtx, owner, intent.ID)
		keys, listErr := r.Objects.ListKeys(cleanupCtx, intent.Prefix, "", 256)
		deleteErr := error(nil)
		if listErr == nil {
			for _, key := range keys {
				if e := r.Objects.Delete(cleanupCtx, key); e != nil {
					deleteErr = e
					break
				}
			}
		}
		if err == nil && (releaseErr != nil || listErr != nil || deleteErr != nil) {
			err = ErrCleanup
		}
	}()
	writer := chattransfer.NewWriter(ctx, r.Objects, intent.Prefix, chatjsonl.MaxFileBytes)
	h := sha256.New()
	if _, err = io.Copy(writer, io.TeeReader(src, h)); err != nil {
		return ErrArtifact
	}
	staged, err := writer.Seal()
	if err != nil {
		return ErrArtifact
	}
	if staged.Bytes != chat.SourceBytes || hex.EncodeToString(h.Sum(nil)) != chat.SourceSHA256 {
		return ErrArtifact
	}
	return safeStoreError(r.Store.StageChatMigration(ctx, owner, m, chat, staged, r.Objects))
}

func matches(m postgres.ChatMigrationManifest, c Config, epoch int64) bool {
	return m.FormatVersion == 1 && m.OwnerAccountID == c.Owner && m.MigrationRunID == c.RunID && m.Direction == c.Direction && m.FrozenAuthorityEpoch == epoch
}

func safeStoreError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("CHAT_TRANSFER_TIMEOUT")
	}
	var chat *postgres.ChatError
	if errors.As(err, &chat) {
		switch chat.Code {
		case "REVISION_CONFLICT", "CHAT_TRANSFER_TIMEOUT", "CHAT_AUTHORITY_CHANGED", "CHAT_MIGRATION_SOURCE_UNAVAILABLE", "IDEMPOTENCY_KEY_REUSED", "CHAT_IMPORT_INVALID", "CHAT_PAYLOAD_TOO_LARGE":
			return errors.New(chat.Code)
		}
	}
	return ErrStore
}
func safeDrainError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, stsource.ErrChatTransferTimeout) || errors.Is(err, context.DeadlineExceeded) {
		return errors.New("CHAT_TRANSFER_TIMEOUT")
	}
	return ErrDrain
}

func (r Runner) reverseExport(ctx context.Context, c Config, m postgres.ChatMigrationManifest, artifact string) error {
	if err := os.Mkdir(artifact, 0700); err != nil {
		return ErrArtifact
	}
	if err := os.Mkdir(filepath.Join(artifact, "files"), 0700); err != nil {
		return ErrArtifact
	}
	for i, chat := range m.Chats {
		if !stsource.ValidIdentity(chat.OldIdentity) {
			return ErrArtifact
		}
		path := "files/" + chat.OldIdentity + ".jsonl"
		if chat.State == "deleted" {
			out, err := r.Store.ReverseExportChatMigration(ctx, c.Owner, c.RunID, chat.OldIdentity, io.Discard)
			if err != nil {
				return safeStoreError(err)
			}
			m.Chats[i] = out
			continue
		}
		f, err := os.OpenFile(filepath.Join(artifact, path), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return ErrArtifact
		}
		out, exportErr := r.Store.ReverseExportChatMigration(ctx, c.Owner, c.RunID, chat.OldIdentity, f)
		closeErr := f.Close()
		if exportErr != nil {
			return safeStoreError(exportErr)
		}
		if closeErr != nil {
			return ErrArtifact
		}
		out.SourceFile = path
		m.Chats[i] = out
	}
	return writeJSON(filepath.Join(artifact, "manifest.json"), m)
}

func ensureArtifactRoot(root string) error {
	st, err := os.Lstat(root)
	if os.IsNotExist(err) {
		if os.Mkdir(root, 0700) != nil {
			return ErrArtifact
		}
		return nil
	}
	if err != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 || st.Mode().Perm()&0077 != 0 {
		return ErrArtifact
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return ErrArtifact
	}
	for _, entry := range entries {
		if entry.Name() != "current" {
			return ErrArtifact
		}
	}
	return nil
}

func publishCurrent(root, artifact string, owner int64) error {
	current := filepath.Join(root, "current")
	if _, err := os.Lstat(current); err == nil {
		old, _, err := readManifest(current)
		if err != nil || old.OwnerAccountID != owner {
			return ErrArtifact
		}
		// The old verified snapshot stays recoverable until the replacement is
		// fully written, verified and ready for the same private slot.
		oldPath := filepath.Join(filepath.Dir(artifact), "previous")
		if os.Rename(current, oldPath) != nil {
			return ErrArtifact
		}
		if os.Rename(artifact, current) != nil {
			_ = os.Rename(oldPath, current)
			return ErrArtifact
		}
		return nil
	} else if !os.IsNotExist(err) {
		return ErrArtifact
	}
	if os.Rename(artifact, current) != nil {
		return ErrArtifact
	}
	return nil
}
