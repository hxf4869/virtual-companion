package chatmigration

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const maxManifestBytes = 256 << 20

// openPrivate rejects links in every path component. Artifact directories are
// private and owned by this invocation; no public upload is read here.
func openPrivate(root, relative string) (*os.File, error) {
	rootInfo, err := os.Lstat(root)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return nil, ErrArtifact
	}
	if relative == "" || filepath.IsAbs(relative) || strings.Contains(relative, "\\") || filepath.Clean(relative) != relative || relative == "." {
		return nil, ErrArtifact
	}
	parts := strings.Split(relative, string(filepath.Separator))
	path := root
	for _, part := range parts {
		if part == ".." || part == "" {
			return nil, ErrArtifact
		}
		path = filepath.Join(path, part)
		st, err := os.Lstat(path)
		if err != nil || st.Mode()&os.ModeSymlink != 0 {
			return nil, ErrArtifact
		}
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, ErrArtifact
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		f.Close()
		return nil, ErrArtifact
	}
	return f, nil
}

func readManifest(root string) (postgres.ChatMigrationManifest, string, error) {
	var manifest postgres.ChatMigrationManifest
	f, err := openPrivate(root, "manifest.json")
	if err != nil {
		return manifest, "", err
	}
	defer f.Close()
	h := sha256.New()
	raw, err := io.ReadAll(io.LimitReader(io.TeeReader(f, h), maxManifestBytes+1))
	if err != nil || len(raw) > maxManifestBytes {
		return manifest, "", ErrArtifact
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.UseNumber()
	d.DisallowUnknownFields()
	if d.Decode(&manifest) != nil || d.Decode(new(any)) != io.EOF {
		return manifest, "", ErrArtifact
	}
	return manifest, hex.EncodeToString(h.Sum(nil)), nil
}

func writeJSON(path string, value any) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return ErrArtifact
	}
	if err = json.NewEncoder(f).Encode(value); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return ErrArtifact
	}
	return nil
}

func checkedChat(root string, chat postgres.ChatMigrationChat) (*os.File, error) {
	if chat.State == "deleted" {
		if chat.SourceFile != "" || chat.SourceBytes != 0 || chat.SourceSHA256 != "" || chat.MessageCount != 0 || chat.CandidateCount != 0 {
			return nil, ErrArtifact
		}
		return nil, nil
	}
	if chat.State != "live" || chat.SourceBytes < 0 || chat.SourceBytes > chatjsonl.MaxFileBytes {
		return nil, ErrArtifact
	}
	f, err := openPrivate(root, chat.SourceFile)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			f.Close()
		}
	}()
	h := sha256.New()
	result, err := chatjsonl.Read(io.TeeReader(f, h), chatjsonl.Handlers{})
	position, seekErr := f.Seek(0, io.SeekCurrent)
	if err != nil || !result.Valid() || seekErr != nil || position != chat.SourceBytes || result.ValidatedMessages != chat.MessageCount || result.ValidatedCandidates != chat.CandidateCount || hex.EncodeToString(h.Sum(nil)) != chat.SourceSHA256 {
		return nil, ErrArtifact
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, ErrArtifact
	}
	ok = true
	return f, nil
}
