package postgres

import (
	"testing"

	"github.com/hxf4869/virtual-companion/internal/stsource"
)

func TestInboxObserveLink(t *testing.T) {
	messageID := "01234567-89ab-4def-8abc-0123456789ab"
	revision := int64(2)
	branch := "branch-a"
	event := InboxEvent{
		EventID: "fu-observe", Intent: "BODY", STDelivered: true,
		MessageID: &messageID, MessageRevision: &revision, Branch: &branch, LinkStatus: "present",
	}
	if got := ObserveInboxLink(event, stsource.Snapshot{State: "PRESENT", BranchRoot: branch, Messages: []stsource.Message{{
		MessageID: messageID, InboxEventID: event.EventID, Revision: 2,
	}}}); got != "present" {
		t.Fatalf("present = %s", got)
	}
	if got := ObserveInboxLink(event, stsource.Snapshot{State: "PRESENT", BranchRoot: branch, Messages: []stsource.Message{{
		MessageID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", InboxEventID: "fu-other", Revision: 1,
	}}}); got != "removed" {
		t.Fatalf("deleted message = %s", got)
	}
	if got := ObserveInboxLink(event, stsource.Snapshot{State: "DELETED", Revision: 4}); got != "removed" {
		t.Fatalf("deleted chat = %s", got)
	}
	if got := ObserveInboxLink(event, stsource.Snapshot{State: "PRESENT", BranchRoot: branch, Messages: []stsource.Message{{
		MessageID: messageID, InboxEventID: "fu-other", Revision: 2,
	}}}); got != "invalidated" {
		t.Fatalf("rolled event = %s", got)
	}
	if got := ObserveInboxLink(event, stsource.Snapshot{State: "PRESENT", BranchRoot: "other-branch", Messages: []stsource.Message{{
		MessageID: messageID, InboxEventID: event.EventID, Revision: 2,
	}}}); got != "invalidated" {
		t.Fatalf("rolled branch = %s", got)
	}
	if got := ObserveInboxLink(event, stsource.Snapshot{State: "PRESENT", BranchRoot: branch, Messages: []stsource.Message{{
		MessageID: messageID, InboxEventID: event.EventID, Revision: 1,
	}}}); got != "invalidated" {
		t.Fatalf("older revision = %s", got)
	}
	if got := ObserveInboxLink(event, stsource.Snapshot{State: "UNAVAILABLE"}); got != "present" {
		t.Fatalf("unavailable = %s", got)
	}
	if got := ObserveInboxLink(event, stsource.Snapshot{State: "PRESENT", NotModified: true, BranchRoot: "other-branch"}); got != "present" {
		t.Fatalf("not modified = %s", got)
	}
	undelivered := event
	undelivered.STDelivered = false
	undelivered.MessageID = nil
	if got := ObserveInboxLink(undelivered, stsource.Snapshot{State: "PRESENT"}); got != "present" {
		t.Fatalf("not delivered = %s", got)
	}
}
