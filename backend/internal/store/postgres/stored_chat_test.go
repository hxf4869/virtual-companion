package postgres

import "testing"

func TestStoredChatRequiresEncryptedObjects(t *testing.T) {
	var empty Store
	if _, err := empty.encodeChatJSON(ChatData{"mes": "synthetic"}); err == nil {
		t.Fatal("missing cipher wrote plaintext")
	}
	cipher, err := NewDefaultFieldCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatal(err)
	}
	s := Store{cipher: cipher}
	if _, err = s.encodeChatJSON(nil); err == nil {
		t.Fatal("null document accepted")
	}
	encoded, err := s.encodeChatJSON(ChatData{"extension": ChatData{"kept": true}})
	if err != nil {
		t.Fatal(err)
	}
	var decoded ChatData
	if err = s.decodeChatJSON(encoded, &decoded); err != nil || decoded["extension"] == nil {
		t.Fatalf("encrypted JSON roundtrip failed: %v", err)
	}
}
