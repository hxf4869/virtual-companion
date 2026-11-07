package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
)

func TestSX8ExportHeaderMetadataAndProtectedIdentity(t *testing.T) {
	conv, rel := int64(9007199254740993), int64(22)
	character := "synthetic-card"
	chat := StoredChat{StoredChatSummary: StoredChatSummary{ChatID: "synthetic-chat", Revision: 7, BranchRoot: "synthetic-root", ConversationID: &conv, RelationshipID: &rel, CharacterRef: &character},
		Header:   ChatData{"user_name": "synthetic", "extension": json.Number("900719925474099312345"), "vc_f2": ChatData{"id": "old"}, "vc_binding": ChatData{"mode": "STORY", "chatIdentity": "old"}},
		Metadata: ChatData{"variables": ChatData{"large": json.Number("900719925474099312345")}, "vc_f2": ChatData{"id": "stale", "parent": "discard"}, "vc_binding": ChatData{"mode": "wrong"}}}
	header := storedChatExportHeader(chat)
	metadata := asChatData(header["chat_metadata"])
	if _, exists := header["vc_f2"]; exists {
		t.Fatal("protected identity leaked outside chat_metadata")
	}
	if asChatData(metadata["vc_f2"])["revision"] != int64(7) || asChatData(metadata["vc_f2"])["parent"] != nil || metadata["vc_branch_root"] != "synthetic-root" {
		t.Fatal("incorrect protected metadata")
	}
	binding := asChatData(metadata["vc_binding"])
	if binding["conversationId"] != "9007199254740993" || binding["chatIdentity"] != "synthetic-chat" || binding["mode"] != "STORY" {
		t.Fatal("incorrect binding")
	}
	if asChatData(chat.Metadata["vc_f2"])["id"] != "stale" || chat.Header["vc_f2"] == nil {
		t.Fatal("mutated source documents")
	}
	var b bytes.Buffer
	if err := chatjsonl.NewWriter(&b).WriteHeader(map[string]any(header)); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(b.Bytes(), []byte("900719925474099312345")) {
		t.Fatal("large number changed")
	}
	group := chat
	group.ConversationID = nil
	group.RelationshipID = nil
	if _, exists := asChatData(storedChatExportHeader(group)["chat_metadata"])["vc_binding"]; exists {
		t.Fatal("group inherited stale binding")
	}
}
func TestSX8ExportWriterBoundsAndCancellation(t *testing.T) {
	var b bytes.Buffer
	output := &chatExportWriter{ctx: context.Background(), dst: &b, limit: 2}
	if n, err := output.Write([]byte("{}\n")); err != nil || n != 3 || output.bytes != 3 {
		t.Fatal("incorrect exact byte count")
	}
	_, err := output.Write([]byte("123\n"))
	var ce *ChatError
	if !errors.As(output.result(err), &ce) || ce.Code != "CHAT_PAYLOAD_TOO_LARGE" || b.String() != "{}\n" {
		t.Fatal("accepted over-limit record")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	output = &chatExportWriter{ctx: ctx, dst: io.Discard, limit: 100}
	if _, err = output.Write([]byte("{}\n")); !errors.Is(err, context.Canceled) {
		t.Fatal("ignored cancellation")
	}
}
