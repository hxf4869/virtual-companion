package chatmigration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

const testRun = "10000000-0000-4000-8000-000000000001"
const testChat = "20000000-0000-4000-8000-000000000001"
const testBody = "{}\n{\"mes\":\"synthetic\",\"unknown\":9007199254740993}\n"

type fakeStore struct {
	steps                                  *[]string
	manifest                               postgres.ChatMigrationManifest
	stageError, verifyError, activateError error
	staged                                 map[string]string
	activateCalls, reverseCalls            int
}

func (s *fakeStore) step(v string) { *s.steps = append(*s.steps, v) }
func (s *fakeStore) FreezeChatMigration(_ context.Context, owner int64, run, direction, mode string, epoch int64) (postgres.ChatMigrationRun, error) {
	s.step("freeze")
	if owner != 101 || run != testRun || epoch != 1 || (direction == "ST_TO_GO" && mode != "ST") || (direction == "GO_TO_ST" && mode != "GO") {
		return postgres.ChatMigrationRun{}, errors.New("private owner detail")
	}
	return postgres.ChatMigrationRun{RunID: run, Direction: direction, FrozenEpoch: 2, Status: "FROZEN"}, nil
}
func (s *fakeStore) ChatMigrationSupplement(context.Context, int64, string) (postgres.ChatMigrationManifest, error) {
	s.step("supplement")
	return s.manifest, nil
}
func (s *fakeStore) StageChatMigration(ctx context.Context, owner int64, m postgres.ChatMigrationManifest, c postgres.ChatMigrationChat, manifest chattransfer.Manifest, objects chattransfer.Objects) error {
	s.step("stage")
	if s.stageError != nil {
		return s.stageError
	}
	if owner != 101 || m.OwnerAccountID != 101 {
		return errors.New("wrong owner")
	}
	if s.staged == nil {
		s.staged = map[string]string{}
	}
	r, err := chattransfer.NewReader(ctx, objects, manifest)
	if err != nil {
		return err
	}
	body, _ := io.ReadAll(r)
	if old, ok := s.staged[c.OldIdentity]; ok && old != string(body) {
		return errors.New("checkpoint changed")
	}
	s.staged[c.OldIdentity] = string(body)
	return nil
}
func (s *fakeStore) BeginChatTransfer(context.Context, int64) (postgres.ChatTransferIntent, error) {
	return postgres.ChatTransferIntent{ID: "intent", Prefix: "test-prefix/"}, nil
}
func (s *fakeStore) ReleaseChatTransfer(context.Context, int64, string) error { return nil }

type fakeObjects map[string][]byte

func (o fakeObjects) Put(_ context.Context, k string, b []byte) (int64, error) {
	o[k] = append([]byte(nil), b...)
	return int64(len(b)), nil
}
func (o fakeObjects) GetLimited(_ context.Context, k string, _ int64) ([]byte, error) {
	return o[k], nil
}
func (o fakeObjects) Delete(_ context.Context, k string) error { delete(o, k); return nil }
func (o fakeObjects) ListKeys(_ context.Context, prefix, _ string, limit int) ([]string, error) {
	out := []string{}
	for k := range o {
		if strings.HasPrefix(k, prefix) && len(out) < limit {
			out = append(out, k)
		}
	}
	return out, nil
}
func (s *fakeStore) VerifyChatMigration(context.Context, int64, postgres.ChatMigrationManifest) error {
	s.step("verify")
	return s.verifyError
}
func (s *fakeStore) ActivateChatMigration(context.Context, int64, string, int64) (int64, error) {
	s.step("activate")
	s.activateCalls++
	return 3, s.activateError
}
func (s *fakeStore) ReverseExportChatMigration(_ context.Context, _ int64, _ string, id string, dst io.Writer) (postgres.ChatMigrationChat, error) {
	s.step("reverse-export")
	s.reverseCalls++
	if id != testChat {
		return postgres.ChatMigrationChat{}, errors.New("wrong chat")
	}
	_, err := io.WriteString(dst, testBody)
	return s.manifest.Chats[0], err
}

type fakeGate struct {
	steps    *[]string
	err      error
	badDrain bool
}

func (g fakeGate) FreezeChatAdmission(_ context.Context, owner int64, run, epoch string) (stsource.ChatCutoverStatus, error) {
	*g.steps = append(*g.steps, "close")
	return stsource.ChatCutoverStatus{}, g.err
}
func (g fakeGate) DrainChatHandlers(_ context.Context, owner int64, run, epoch string) (stsource.ChatCutoverStatus, error) {
	*g.steps = append(*g.steps, "drain")
	return stsource.ChatCutoverStatus{OwnerAccountID: strconv.FormatInt(owner, 10), RunID: run, AuthorityEpoch: epoch, State: "DRAINED", Closed: true, Durable: true, ActiveHandlers: map[bool]int64{false: 0, true: 1}[g.badDrain]}, g.err
}

type fakeSnapshot struct {
	steps             *[]string
	manifest          postgres.ChatMigrationManifest
	badHash, badOwner bool
	restoreErr        error
}

func (n *fakeSnapshot) Run(ctx context.Context, op string, in SnapshotInput) error {
	*n.steps = append(*n.steps, op)
	if op == "restore" {
		if in.CurrentGoExport == nil || in.CurrentGoExport.ManifestSHA256 == "" {
			return errors.New("missing fresh attestation")
		}
		m, digest, err := readManifest(in.ArtifactRoot)
		if err != nil || digest != in.CurrentGoExport.ManifestSHA256 || m.Direction != "GO_TO_ST" {
			return ErrArtifact
		}
		if os.Mkdir(in.Root, 0700) != nil {
			return ErrArtifact
		}
		if n.restoreErr != nil {
			return n.restoreErr
		}
		if err := os.Mkdir(filepath.Join(in.Root, ".vc-f2"), 0700); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(in.Root, ".vc-f2/chat-cutover.json"), map[string]any{"version": 1, "ownerAccountId": in.OwnerAccountID, "runId": in.MigrationRunID, "epoch": in.FrozenAuthorityEpoch, "closed": true}); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(in.Root, ".vc-f2/migration-manifest.archive"), m); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(in.Root, "closed"), []byte("true"), 0600)
	}
	if op == "finalize" {
		if in.ActivatedAuthorityEpoch != "3" {
			return errors.New("bad active epoch")
		}
		if err := os.Remove(filepath.Join(in.Root, ".vc-f2/chat-cutover.json")); err != nil {
			return err
		}
		return os.Remove(filepath.Join(in.Root, "closed"))
	}
	if op != "export" {
		return ErrInvalid
	}
	if err := os.Mkdir(in.ArtifactRoot, 0700); err != nil {
		return err
	}
	if err := os.Mkdir(filepath.Join(in.ArtifactRoot, "files"), 0700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(in.ArtifactRoot, "files", testChat+".jsonl"), []byte(testBody), 0600); err != nil {
		return err
	}
	m := n.manifest
	if n.badHash {
		m.Chats = append([]postgres.ChatMigrationChat(nil), m.Chats...)
		m.Chats[0].SourceSHA256 = strings.Repeat("0", 64)
	}
	if n.badOwner {
		m.OwnerAccountID = 999
	}
	return writeJSON(filepath.Join(in.ArtifactRoot, "manifest.json"), m)
}

func TestReverseVerifiedClosedRootResumesWithFreshExport(t *testing.T) {
	r, c, s, _, _ := fixture(t, "GO_TO_ST")
	if _, err := r.Run(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	c.Activate = true
	if _, err := r.Run(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	if s.reverseCalls != 2 || s.activateCalls != 1 {
		t.Fatal("resume reused old archive or failed to activate")
	}
	noTemporaryFiles(t, c)
}

func fixture(t *testing.T, direction string) (Runner, Config, *fakeStore, *fakeSnapshot, *[]string) {
	t.Helper()
	h := sha256.Sum256([]byte(testBody))
	m := postgres.ChatMigrationManifest{FormatVersion: 1, MigrationRunID: testRun, Direction: direction, OwnerAccountID: 101, FrozenAuthorityEpoch: 2, Chats: []postgres.ChatMigrationChat{{OldIdentity: testChat, State: "live", SourceFile: "files/" + testChat + ".jsonl", SourceSHA256: hex.EncodeToString(h[:]), SourceBytes: int64(len(testBody)), MessageCount: 1, CandidateCount: 1}}, DeletionAndSuppressionRecords: []postgres.ChatData{}}
	steps := []string{}
	s := &fakeStore{steps: &steps, manifest: m}
	n := &fakeSnapshot{steps: &steps, manifest: m}
	r := Runner{Store: s, Gate: fakeGate{steps: &steps}, Snapshot: n, Objects: fakeObjects{}}
	base := t.TempDir()
	c := Config{Owner: 101, RunID: testRun, Direction: direction, ExpectedEpoch: 1, STRoot: filepath.Join(base, "st"), ArtifactRoot: filepath.Join(base, "artifacts")}
	if direction == "ST_TO_GO" {
		if err := os.Mkdir(c.STRoot, 0700); err != nil {
			t.Fatal(err)
		}
	}
	return r, c, s, n, &steps
}

func noTemporaryFiles(t *testing.T, c Config) {
	t.Helper()
	entries, err := os.ReadDir(c.ArtifactRoot)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() != "current" {
			t.Fatalf("temporary resource retained: %s", entry.Name())
		}
	}
}

func TestForwardOrderCheckpointResumeAndExplicitActivation(t *testing.T) {
	r, c, s, _, steps := fixture(t, "ST_TO_GO")
	out, err := r.Run(context.Background(), c)
	if err != nil || out.Chats != 1 || out.Messages != 1 || out.Activated || s.activateCalls != 0 {
		t.Fatalf("run: %+v %v", out, err)
	}
	if want := []string{"freeze", "close", "drain", "supplement", "export", "stage", "verify"}; !reflect.DeepEqual(*steps, want) {
		t.Fatalf("order: %v", *steps)
	}
	c.Activate = true
	if _, err := r.Run(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	if len(s.staged) != 1 || s.activateCalls != 1 {
		t.Fatal("checkpoint duplicated or activation missing")
	}
	noTemporaryFiles(t, c)
}

func TestErrorsNeverActivateAndCleanResources(t *testing.T) {
	for _, kind := range []string{"unproven-drain", "hash", "owner", "stage", "verify", "cancel"} {
		t.Run(kind, func(t *testing.T) {
			r, c, s, n, steps := fixture(t, "ST_TO_GO")
			c.Activate = true
			switch kind {
			case "unproven-drain":
				r.Gate = fakeGate{steps: steps, badDrain: true}
			case "hash":
				n.badHash = true
			case "owner":
				n.badOwner = true
			case "stage":
				s.stageError = errors.New("private path and source body")
			case "verify":
				s.verifyError = errors.New("UNAVAILABLE source")
			case "cancel":
				s.stageError = context.Canceled
			}
			_, err := r.Run(context.Background(), c)
			if err == nil || s.activateCalls != 0 || strings.Contains(err.Error(), "private") {
				t.Fatalf("failure leaked or activated: %v", err)
			}
			noTemporaryFiles(t, c)
			if _, err := os.Stat(filepath.Join(c.ArtifactRoot, "current")); !os.IsNotExist(err) {
				t.Fatal("invalid snapshot retained")
			}
		})
	}
}

func TestReverseAlwaysExportsCurrentGoAndRestoresClosedUntilCAS(t *testing.T) {
	r, c, s, _, steps := fixture(t, "GO_TO_ST")
	c.Activate = true
	out, err := r.Run(context.Background(), c)
	if err != nil || !out.Activated || s.reverseCalls != 1 {
		t.Fatalf("reverse: %+v %v steps=%v", out, err, *steps)
	}
	if want := []string{"freeze", "supplement", "reverse-export", "restore", "verify", "activate", "finalize"}; !reflect.DeepEqual(*steps, want) {
		t.Fatalf("order: %v", *steps)
	}
	if _, err := os.Stat(filepath.Join(c.STRoot, "closed")); !os.IsNotExist(err) {
		t.Fatal("closed gate not finalized")
	}
	noTemporaryFiles(t, c)
}

func TestReverseVerificationFailureRemovesIsolatedRoot(t *testing.T) {
	r, c, s, _, _ := fixture(t, "GO_TO_ST")
	s.verifyError = errors.New("rights unavailable")
	c.Activate = true
	if _, err := r.Run(context.Background(), c); err == nil {
		t.Fatal("accepted unavailable rights")
	}
	if s.activateCalls != 0 {
		t.Fatal("activated before rights verification")
	}
	if _, err := os.Stat(c.STRoot); !os.IsNotExist(err) {
		t.Fatal("failed target retained")
	}
	noTemporaryFiles(t, c)
}

func TestArtifactRejectsTraversalLinksAndMalformedFinalLine(t *testing.T) {
	for _, source := range []string{"../outside", "/absolute", "files/../outside", "files\\outside"} {
		if _, err := openPrivate(t.TempDir(), source); !errors.Is(err, ErrArtifact) {
			t.Fatal("accepted unsafe path")
		}
	}
	root := t.TempDir()
	if err := os.Symlink(t.TempDir(), filepath.Join(root, "files")); err != nil {
		t.Fatal(err)
	}
	if _, err := openPrivate(root, "files/chat.jsonl"); !errors.Is(err, ErrArtifact) {
		t.Fatal("accepted link")
	}
	// A late syntax error never reaches Stage, despite valid previous lines.
	bad := "{}\n{\"mes\":\"ok\"}\n{"
	if err := os.WriteFile(filepath.Join(root, "bad.jsonl"), []byte(bad), 0600); err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256([]byte(bad))
	if _, err := checkedChat(root, postgres.ChatMigrationChat{State: "live", SourceFile: "bad.jsonl", SourceBytes: int64(len(bad)), SourceSHA256: hex.EncodeToString(h[:]), MessageCount: 1, CandidateCount: 1}); !errors.Is(err, ErrArtifact) {
		t.Fatal("accepted corrupt final line")
	}
}

func TestExternalRightsNeverAuthorizeAnotherOwner(t *testing.T) {
	r, c, s, _, steps := fixture(t, "GO_TO_ST")
	latest := s.manifest
	latest.OwnerAccountID = 999
	c.LatestRightsManifest = filepath.Join(t.TempDir(), "rights.json")
	if err := writeJSON(c.LatestRightsManifest, latest); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Run(context.Background(), c); !errors.Is(err, ErrArtifact) {
		t.Fatal("external owner authorized migration")
	}
	if len(*steps) != 0 {
		t.Fatal("owner mismatch reached freeze")
	}
}
