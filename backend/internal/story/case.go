// Package story loads the versioned world definition and projects an ActorView.
// PostgreSQL stores the run. This package never calls a model.
package story

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

//go:embed cases/rainy-inn-v1.json
var rainyInn []byte

// ErrInvalid means the case id or definition cannot be used.
var ErrInvalid = errors.New("invalid story case")

// ErrUnknownActor means the actor is not part of the case.
var ErrUnknownActor = errors.New("unknown story actor")

// Participant is one cast member of a case. Relationship mapping belongs to W14.
type Participant struct {
	ActorID string
	Name    string
	Role    string
	Scene   string
}

// Spec is the slice of a case needed to open a run.
type Spec struct {
	CaseID       string
	WorldVersion int64
	Stage        string
	Participants []Participant
}

// Event is one committed world event. Visibility is a server-side filter.
type Event struct {
	ID           int64
	ActorID      string
	Visibility   []string
	WorldVersion int64
	Body         json.RawMessage
}

// Scope identifies the view. WorldVersion is the run's current version.
type Scope struct {
	ConversationID int64
	RunID          int64
	BranchID       int64
	ActorID        string
	WorldVersion   int64
}

// PublicParticipant is one NPC's public identity. Private goals stay in the definition.
type PublicParticipant struct {
	ActorID       string `json:"actorId"`
	Name          string `json:"name"`
	PublicPersona string `json:"publicPersona"`
}

// View is safe to show to one actor. It has no GM-truth fields.
type View struct {
	ConversationID string              `json:"conversationId"`
	RunID          string              `json:"runId"`
	BranchID       string              `json:"branchId"`
	ActorID        string              `json:"actorId"`
	WorldVersion   int64               `json:"worldVersion"`
	PublicLore     PublicLore          `json:"publicLore"`
	Knowledge      []Knowledge         `json:"knowledge"`
	Events         []VisibleEvent      `json:"events"`
	Participants   []PublicParticipant `json:"participants"`
}

// PublicLore is the case's public setting.
type PublicLore struct {
	Setting    string   `json:"setting"`
	Locations  []string `json:"locations"`
	KnownEvent string   `json:"knownEvent"`
}

// Knowledge is one fact the actor already knows.
type Knowledge struct {
	ID     string `json:"id"`
	Fact   string `json:"fact"`
	Marker string `json:"marker"`
}

// VisibleEvent is an event whose visibility includes the actor.
type VisibleEvent struct {
	EventID      string          `json:"eventId"`
	ActorID      string          `json:"actorId"`
	WorldVersion int64           `json:"worldVersion"`
	Body         json.RawMessage `json:"body"`
}

type definition struct {
	CaseID     string `json:"case_id"`
	PublicLore struct {
		Setting    string   `json:"setting"`
		Locations  []string `json:"locations"`
		KnownEvent string   `json:"known_event"`
	} `json:"public_lore"`
	Actors []struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		Role          string `json:"role"`
		PublicPersona string `json:"public_persona"`
	} `json:"actors"`
	GM struct {
		Marker        string `json:"marker"`
		Motive        string `json:"motive"`
		WatchLocation string `json:"watch_location"`
		Timeline      []struct {
			Fact string `json:"fact"`
		} `json:"timeline"`
	} `json:"gm_truth"`
	Private []struct {
		ID      string   `json:"id"`
		KnownBy []string `json:"known_by"`
		Fact    string   `json:"fact"`
		Marker  string   `json:"marker"`
	} `json:"initial_private_knowledge"`
	Initial struct {
		Version int64  `json:"version"`
		Phase   string `json:"phase"`
	} `json:"initial_state"`
	Rules []json.RawMessage `json:"rules"`
}

// Open returns the run spec for an embedded case.
func Open(caseID string) (Spec, error) {
	def, err := load(caseID)
	if err != nil {
		return Spec{}, err
	}
	scene := strings.TrimSpace(def.PublicLore.Locations[0])
	participants := make([]Participant, 0, len(def.Actors))
	for _, actor := range def.Actors {
		participants = append(participants, Participant{
			ActorID: actor.ID, Name: actor.Name, Role: actor.Role, Scene: scene,
		})
	}
	return Spec{
		CaseID: def.CaseID, WorldVersion: def.Initial.Version, Stage: def.Initial.Phase,
		Participants: participants,
	}, nil
}

// ActorView projects public lore, the public NPC cast, the actor's own
// initial knowledge, and events visible to that actor. GM truth and other
// actors' private knowledge stay in the definition and are not copied onto
// the result.
func ActorView(caseID string, scope Scope, events []Event) (View, error) {
	def, err := load(caseID)
	if err != nil {
		return View{}, err
	}
	if scope.ConversationID <= 0 || scope.RunID <= 0 || scope.BranchID <= 0 || scope.WorldVersion < 0 {
		return View{}, ErrInvalid
	}
	if !knownActor(def, scope.ActorID) {
		return View{}, ErrUnknownActor
	}
	locations := append([]string(nil), def.PublicLore.Locations...)
	knowledge := make([]Knowledge, 0)
	for _, item := range def.Private {
		if !contains(item.KnownBy, scope.ActorID) {
			continue
		}
		knowledge = append(knowledge, Knowledge{ID: item.ID, Fact: item.Fact, Marker: item.Marker})
	}
	visible := make([]VisibleEvent, 0)
	for _, event := range events {
		if !contains(event.Visibility, scope.ActorID) {
			continue
		}
		body, err := objectBody(event.Body)
		if err != nil {
			return View{}, err
		}
		visible = append(visible, VisibleEvent{
			EventID: strconv.FormatInt(event.ID, 10), ActorID: event.ActorID,
			WorldVersion: event.WorldVersion, Body: body,
		})
	}
	return View{
		ConversationID: strconv.FormatInt(scope.ConversationID, 10),
		RunID:          strconv.FormatInt(scope.RunID, 10),
		BranchID:       strconv.FormatInt(scope.BranchID, 10),
		ActorID:        scope.ActorID,
		WorldVersion:   scope.WorldVersion,
		PublicLore: PublicLore{
			Setting: def.PublicLore.Setting, Locations: locations, KnownEvent: def.PublicLore.KnownEvent,
		},
		Knowledge:    knowledge,
		Events:       visible,
		Participants: publicParticipants(def),
	}, nil
}

func publicParticipants(def definition) []PublicParticipant {
	out := make([]PublicParticipant, 0)
	for _, actor := range def.Actors {
		if actor.Role != "npc" {
			continue
		}
		out = append(out, PublicParticipant{
			ActorID: actor.ID, Name: actor.Name, PublicPersona: actor.PublicPersona,
		})
	}
	return out
}

func load(caseID string) (definition, error) {
	if strings.TrimSpace(caseID) == "" {
		return definition{}, ErrInvalid
	}
	var def definition
	if err := json.Unmarshal(rainyInn, &def); err != nil {
		return definition{}, ErrInvalid
	}
	if err := validate(def); err != nil {
		return definition{}, err
	}
	if caseID != def.CaseID {
		return definition{}, ErrInvalid
	}
	return def, nil
}

func validate(def definition) error {
	if def.CaseID == "" || def.Initial.Version < 0 || strings.TrimSpace(def.Initial.Phase) == "" {
		return ErrInvalid
	}
	if len(def.PublicLore.Locations) == 0 || strings.TrimSpace(def.PublicLore.Locations[0]) == "" {
		return ErrInvalid
	}
	if strings.TrimSpace(def.PublicLore.Setting) == "" || strings.TrimSpace(def.PublicLore.KnownEvent) == "" {
		return ErrInvalid
	}
	if len(def.Rules) == 0 || strings.TrimSpace(def.GM.Marker) == "" || len(def.Private) == 0 {
		return ErrInvalid
	}
	seen := map[string]bool{}
	players := 0
	for _, actor := range def.Actors {
		if actor.ID == "" || actor.Name == "" || seen[actor.ID] || (actor.Role != "player" && actor.Role != "npc") {
			return ErrInvalid
		}
		seen[actor.ID] = true
		if actor.Role == "player" {
			players++
		}
	}
	if players != 1 {
		return ErrInvalid
	}
	return nil
}

func knownActor(def definition, actorID string) bool {
	for _, actor := range def.Actors {
		if actor.ID == actorID {
			return true
		}
	}
	return false
}

func contains(ids []string, actor string) bool {
	for _, id := range ids {
		if id == actor {
			return true
		}
	}
	return false
}

func objectBody(raw json.RawMessage) (json.RawMessage, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' || !json.Valid(raw) {
		return nil, ErrInvalid
	}
	out := make(json.RawMessage, len(raw))
	copy(out, raw)
	return out, nil
}
