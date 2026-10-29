package story

import (
	"bytes"
	"encoding/json"
	"strings"
)

// Rejection reasons are stable codes. They carry no world fact.
const (
	RejectBadCommand       = "bad_command"
	RejectUnknownActor     = "unknown_actor"
	RejectActionNotAllowed = "action_not_allowed"
	RejectNoMatchingRule   = "no_matching_rule"
	RejectPrecondition     = "precondition_failed"
)

// State is the world a rule sees: version, items, clues, and committed events.
// Apply does not persist or lock this value.
type State struct {
	Version            int64
	Phase              string
	KeyHolder          string
	WatchLocation      string
	PlayerClues        []string
	Ended              bool
	ActorRevealedClues map[string][]string
	Events             []Event
}

// Command is one allowed action, or a dialogue statement when Action is empty.
// A statement is stored as an event and does not change items or truth.
// ActionID is the idempotency key.
type Command struct {
	ActionID string
	ActorID  string
	Action   string
	Target   string
	ClueID   string
	Text     string
}

// Decision is the pure result of one command. On rejection or replay, Events
// is empty and State compares equal to the input. Events holds only the new event.
type Decision struct {
	Accepted bool
	Replay   bool
	Reason   string
	State    State
	Events   []Event
}

type actionDef struct {
	CaseID string `json:"case_id"`
	Actors []struct {
		ID   string `json:"id"`
		Role string `json:"role"`
	} `json:"actors"`
	Initial struct {
		Version            int64               `json:"version"`
		Phase              string              `json:"phase"`
		KeyHolder          string              `json:"key_holder"`
		WatchLocation      string              `json:"watch_location"`
		PlayerClues        []string            `json:"player_clues"`
		Ended              bool                `json:"ended"`
		ActorRevealedClues map[string][]string `json:"actor_revealed_clues"`
	} `json:"initial_state"`
	Clues   []clueDef `json:"clues"`
	Allowed []string  `json:"allowed_actions"`
	Rules   []rule    `json:"rules"`
	Path    []struct {
		ActionID string `json:"action_id"`
		Action   string `json:"action"`
		Target   string `json:"target"`
		ClueID   string `json:"clue_id"`
	} `json:"deterministic_success_path"`
}

type clueDef struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Qualification string `json:"qualification"`
}

type rule struct {
	ID                  string          `json:"id"`
	Action              string          `json:"action"`
	Target              string          `json:"target"`
	Visibility          []string        `json:"visibility"`
	RequiresPlayerClues []string        `json:"requires_player_clues"`
	RequiresTargetKnows []string        `json:"requires_target_knows"`
	Requires            json.RawMessage `json:"requires"`
	Effect              json.RawMessage `json:"effect"`
}

type objectEffect struct {
	GrantPlayerClue string `json:"grant_player_clue"`
	KeyHolder       string `json:"key_holder"`
	WatchLocation   string `json:"watch_location"`
	Ended           *bool  `json:"ended"`
	Phase           string `json:"phase"`
}

type eventBody struct {
	Kind          string `json:"kind"`
	ActionID      string `json:"actionId"`
	Action        string `json:"action,omitempty"`
	ActorID       string `json:"actorId"`
	RuleID        string `json:"ruleId,omitempty"`
	Target        string `json:"target,omitempty"`
	ClueID        string `json:"clueId,omitempty"`
	ClueName      string `json:"clueName,omitempty"`
	Qualification string `json:"qualification,omitempty"`
	Text          string `json:"text,omitempty"`
	Phase         string `json:"phase,omitempty"`
	Ended         *bool  `json:"ended,omitempty"`
}

// InitialState reads the embedded case's starting world. It has no events.
func InitialState(caseID string) (State, error) {
	def, err := actionDefinition(caseID)
	if err != nil {
		return State{}, err
	}
	return State{
		Version:            def.Initial.Version,
		Phase:              def.Initial.Phase,
		KeyHolder:          def.Initial.KeyHolder,
		WatchLocation:      def.Initial.WatchLocation,
		PlayerClues:        cloneStrings(def.Initial.PlayerClues),
		Ended:              def.Initial.Ended,
		ActorRevealedClues: cloneRevealed(def.Initial.ActorRevealedClues),
		Events:             []Event{},
	}, nil
}

// DeterministicSuccessPath reads the embedded success path and fills in the player.
// It does not apply the commands.
func DeterministicSuccessPath(caseID string) ([]Command, error) {
	def, err := actionDefinition(caseID)
	if err != nil {
		return nil, err
	}
	player := def.playerID()
	if player == "" || len(def.Path) == 0 {
		return nil, ErrInvalid
	}
	out := make([]Command, 0, len(def.Path))
	for _, step := range def.Path {
		if strings.TrimSpace(step.ActionID) == "" || strings.TrimSpace(step.Action) == "" {
			return nil, ErrInvalid
		}
		out = append(out, Command{
			ActionID: step.ActionID,
			ActorID:  player,
			Action:   step.Action,
			Target:   step.Target,
			ClueID:   step.ClueID,
		})
	}
	return out, nil
}

// Apply runs one command with the embedded case rules.
// The input state is left unchanged. Persistence and concurrency belong elsewhere.
func Apply(caseID string, state State, cmd Command) (Decision, error) {
	def, err := actionDefinition(caseID)
	if err != nil {
		return Decision{}, err
	}
	cmd = normalizeCommand(cmd)
	if cmd.ActionID == "" {
		return reject(state, RejectBadCommand), nil
	}
	if committed(state.Events, cmd.ActionID) {
		return Decision{Accepted: true, Replay: true, State: cloneState(state)}, nil
	}
	if cmd.Action == "" {
		return applyStatement(def, state, cmd), nil
	}
	if !def.known(cmd.ActorID) {
		return reject(state, RejectUnknownActor), nil
	}
	if !contains(def.Allowed, cmd.Action) {
		return reject(state, RejectActionNotAllowed), nil
	}
	if cmd.Action == "ask" {
		return applyAsk(def, state, cmd), nil
	}
	return applyRule(def, state, cmd)
}

func applyStatement(def actionDef, state State, cmd Command) Decision {
	if cmd.Text == "" || cmd.Target == "" || cmd.Target == cmd.ActorID {
		return reject(state, RejectBadCommand)
	}
	if !def.known(cmd.ActorID) || !def.known(cmd.Target) {
		return reject(state, RejectUnknownActor)
	}
	body := eventBody{Kind: "statement", ActionID: cmd.ActionID, ActorID: cmd.ActorID, Target: cmd.Target, Text: cmd.Text}
	return commit(state, cmd, []string{cmd.ActorID, cmd.Target}, body, false)
}

func applyAsk(def actionDef, state State, cmd Command) Decision {
	if cmd.Target == "" || cmd.Target == cmd.ActorID {
		return reject(state, RejectBadCommand)
	}
	if !def.known(cmd.Target) {
		return reject(state, RejectUnknownActor)
	}
	body := eventBody{Kind: "action", ActionID: cmd.ActionID, Action: cmd.Action, ActorID: cmd.ActorID, Target: cmd.Target, Text: cmd.Text}
	return commit(state, cmd, []string{cmd.ActorID, cmd.Target}, body, false)
}

func applyRule(def actionDef, state State, cmd Command) (Decision, error) {
	if cmd.ActorID != def.playerID() {
		return reject(state, RejectBadCommand), nil
	}
	matched, ok := matchRule(def.Rules, cmd.Action, cmd.Target)
	if !ok {
		return reject(state, RejectNoMatchingRule), nil
	}
	if state.Ended {
		return reject(state, RejectPrecondition), nil
	}
	effect, prose, err := matched.effect()
	if err != nil {
		return Decision{}, err
	}
	if prose {
		if cmd.Action != "show_clue" {
			return Decision{}, ErrInvalid
		}
		return applyShow(def, state, cmd, matched), nil
	}
	return applyObject(def, state, cmd, matched, effect)
}

func applyShow(def actionDef, state State, cmd Command, matched rule) Decision {
	clue, known := def.clue(cmd.ClueID)
	if cmd.ClueID == "" || !known || !contains(state.PlayerClues, cmd.ClueID) {
		return reject(state, RejectPrecondition)
	}
	if cmd.Target == "" || cmd.Target == cmd.ActorID {
		return reject(state, RejectBadCommand)
	}
	if !def.known(cmd.Target) {
		return reject(state, RejectUnknownActor)
	}
	next := cloneState(state)
	if next.ActorRevealedClues == nil {
		next.ActorRevealedClues = map[string][]string{}
	}
	next.ActorRevealedClues[cmd.Target] = addClue(next.ActorRevealedClues[cmd.Target], cmd.ClueID)
	next.Version++
	body := eventBody{
		Kind: "action", ActionID: cmd.ActionID, Action: cmd.Action, ActorID: cmd.ActorID,
		RuleID: matched.ID, Target: cmd.Target, ClueID: clue.ID, ClueName: clue.Name, Qualification: clue.Qualification,
	}
	// The prose rule shows the clue to the player and the target, and to nobody else.
	return commitExisting(next, cmd, []string{def.playerID(), cmd.Target}, body)
}

func applyObject(def actionDef, state State, cmd Command, matched rule, effect objectEffect) (Decision, error) {
	key, err := matched.requiredKey()
	if err != nil {
		return Decision{}, err
	}
	if key != "" && state.KeyHolder != key {
		return reject(state, RejectPrecondition), nil
	}
	if !containsAll(state.PlayerClues, matched.RequiresPlayerClues) || !containsAll(state.ActorRevealedClues[cmd.Target], matched.RequiresTargetKnows) {
		return reject(state, RejectPrecondition), nil
	}
	if len(matched.Visibility) == 0 {
		return Decision{}, ErrInvalid
	}
	next := cloneState(state)
	clueID := effect.GrantPlayerClue
	if clueID != "" {
		next.PlayerClues = addClue(next.PlayerClues, clueID)
	}
	if effect.KeyHolder != "" {
		next.KeyHolder = effect.KeyHolder
	}
	if effect.WatchLocation != "" {
		next.WatchLocation = effect.WatchLocation
	}
	if effect.Ended != nil {
		next.Ended = *effect.Ended
	}
	if effect.Phase != "" {
		next.Phase = effect.Phase
	}
	next.Version++
	clue, _ := def.clue(clueID)
	body := eventBody{
		Kind: "action", ActionID: cmd.ActionID, Action: cmd.Action, ActorID: cmd.ActorID, RuleID: matched.ID,
		ClueID: clue.ID, ClueName: clue.Name, Qualification: clue.Qualification,
	}
	if def.known(cmd.Target) {
		body.Target = cmd.Target
	}
	if effect.Phase != "" {
		body.Phase = effect.Phase
	}
	if effect.Ended != nil {
		ended := *effect.Ended
		body.Ended = &ended
	}
	return commitExisting(next, cmd, matched.Visibility, body), nil
}

func commit(state State, cmd Command, visibility []string, body eventBody, bump bool) Decision {
	next := cloneState(state)
	if bump {
		next.Version++
	}
	return commitExisting(next, cmd, visibility, body)
}

func commitExisting(state State, cmd Command, visibility []string, body eventBody) Decision {
	raw, err := json.Marshal(body)
	if err != nil {
		return reject(state, RejectBadCommand)
	}
	ev := Event{
		ID: nextEventID(state.Events), ActionID: cmd.ActionID, ActorID: cmd.ActorID,
		Visibility: cloneStrings(visibility), WorldVersion: state.Version, Body: raw,
	}
	state.Events = append(state.Events, cloneEvent(ev))
	return Decision{Accepted: true, State: state, Events: []Event{cloneEvent(ev)}}
}

func reject(state State, reason string) Decision {
	return Decision{Reason: reason, State: cloneState(state)}
}

func actionDefinition(caseID string) (actionDef, error) {
	if _, err := load(caseID); err != nil {
		return actionDef{}, err
	}
	var def actionDef
	if err := json.Unmarshal(rainyInn, &def); err != nil || def.CaseID != caseID {
		return actionDef{}, ErrInvalid
	}
	if def.playerID() == "" || len(def.Allowed) == 0 || len(def.Rules) == 0 || strings.TrimSpace(def.Initial.Phase) == "" {
		return actionDef{}, ErrInvalid
	}
	return def, nil
}

func (d actionDef) playerID() string {
	for _, actor := range d.Actors {
		if actor.Role == "player" {
			return actor.ID
		}
	}
	return ""
}

func (d actionDef) known(id string) bool {
	for _, actor := range d.Actors {
		if actor.ID == id {
			return true
		}
	}
	return false
}

func (d actionDef) clue(id string) (clueDef, bool) {
	if id == "" {
		return clueDef{}, false
	}
	for _, clue := range d.Clues {
		if clue.ID == id {
			return clue, true
		}
	}
	return clueDef{}, false
}

func (r rule) requiredKey() (string, error) {
	raw := bytes.TrimSpace(r.Requires)
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil
	}
	var req struct {
		KeyHolder string `json:"key_holder"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return "", ErrInvalid
	}
	return req.KeyHolder, nil
}

func (r rule) effect() (objectEffect, bool, error) {
	raw := bytes.TrimSpace(r.Effect)
	if len(raw) == 0 {
		return objectEffect{}, false, ErrInvalid
	}
	if raw[0] == '"' {
		return objectEffect{}, true, nil
	}
	var effect objectEffect
	if err := json.Unmarshal(raw, &effect); err != nil {
		return objectEffect{}, false, ErrInvalid
	}
	return effect, false, nil
}

func matchRule(rules []rule, action, target string) (rule, bool) {
	matched := make([]rule, 0, 1)
	for _, item := range rules {
		if item.Action != action {
			continue
		}
		if item.Target != "" && item.Target != target {
			continue
		}
		matched = append(matched, item)
	}
	if len(matched) == 1 {
		return matched[0], true
	}
	exact := make([]rule, 0, 1)
	for _, item := range matched {
		if item.Target == target {
			exact = append(exact, item)
		}
	}
	if len(exact) == 1 {
		return exact[0], true
	}
	return rule{}, false
}

func normalizeCommand(cmd Command) Command {
	cmd.ActionID = strings.TrimSpace(cmd.ActionID)
	cmd.ActorID = strings.TrimSpace(cmd.ActorID)
	cmd.Action = strings.TrimSpace(cmd.Action)
	cmd.Target = strings.TrimSpace(cmd.Target)
	cmd.ClueID = strings.TrimSpace(cmd.ClueID)
	cmd.Text = strings.TrimSpace(cmd.Text)
	return cmd
}

func committed(events []Event, actionID string) bool {
	for _, ev := range events {
		if actionIDOf(ev) == actionID {
			return true
		}
	}
	return false
}

func actionIDOf(ev Event) string {
	if strings.TrimSpace(ev.ActionID) != "" {
		return ev.ActionID
	}
	var body struct {
		ActionID string `json:"actionId"`
	}
	if len(ev.Body) == 0 || json.Unmarshal(ev.Body, &body) != nil {
		return ""
	}
	return body.ActionID
}

func containsAll(have, need []string) bool {
	for _, id := range need {
		if !contains(have, id) {
			return false
		}
	}
	return true
}

func addClue(list []string, id string) []string {
	if id == "" || contains(list, id) {
		return list
	}
	return append(list, id)
}

func nextEventID(events []Event) int64 {
	var max int64
	for _, ev := range events {
		if ev.ID > max {
			max = ev.ID
		}
	}
	return max + 1
}

func cloneState(s State) State {
	s.PlayerClues = cloneStrings(s.PlayerClues)
	s.ActorRevealedClues = cloneRevealed(s.ActorRevealedClues)
	s.Events = cloneEvents(s.Events)
	return s
}

func cloneRevealed(in map[string][]string) map[string][]string {
	if in == nil {
		return nil
	}
	out := make(map[string][]string, len(in))
	for key, clues := range in {
		out[key] = cloneStrings(clues)
	}
	return out
}

func cloneStrings(in []string) []string {
	if in == nil {
		return nil
	}
	return append([]string(nil), in...)
}

func cloneEvents(in []Event) []Event {
	if in == nil {
		return nil
	}
	out := make([]Event, len(in))
	for i := range in {
		out[i] = cloneEvent(in[i])
	}
	return out
}

func cloneEvent(ev Event) Event {
	ev.Visibility = cloneStrings(ev.Visibility)
	if ev.Body != nil {
		ev.Body = append(json.RawMessage(nil), ev.Body...)
	}
	return ev
}
