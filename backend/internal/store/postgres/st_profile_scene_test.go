package postgres

import "testing"

func TestSceneMatchesQuery(t *testing.T) {
	if !sceneMatchesQuery("今天是周日阅读计划", "周日阅读") {
		t.Fatal("shared CJK bigram did not match")
	}
	if sceneMatchesQuery("今天是周日阅读计划", "航海徽章") {
		t.Fatal("unrelated scene matched")
	}
	if !sceneMatchesQuery("blue", "The Blue Window") {
		t.Fatal("ascii word did not match")
	}
	if sceneMatchesQuery("", "周日阅读") || sceneMatchesQuery("阅", "周日阅读") || sceneMatchesQuery("a", "a book") {
		t.Fatal("empty or single-character query matched")
	}
}
