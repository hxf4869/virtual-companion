package safety

import (
	"strings"
	"unicode/utf8"
)

// Policy is the unique local deterministic safety policy. Rules compile once
// at construction. Input, rolling-window and final-full-output reviews use
// the same compiled rule set; rolling and final apply output rules.
//
// There is no second engine, no local ML classifier, and no network call.
type Policy struct {
	rules  []rule
	window int
}

// New compiles the deterministic rule floor. Call once at process start.
func New() *Policy {
	rules := prepareRules(compiledRules())
	return &Policy{rules: rules, window: windowRunes(rules)}
}

// WindowRunes is the bounded tail a rolling reviewer must keep so a risk
// phrase that straddles two deltas is still visible.
func (p *Policy) WindowRunes() int {
	if p == nil || p.window <= 0 {
		return 96
	}
	return p.window
}

// Decision is the body-free review result. Rule ids are catalog codes, not
// matched text.
type Decision struct {
	Allow bool
	Risk  Risk
	Rules []string
}

// Code is the low-cardinality decision code for logs/metrics.
func (d Decision) Code() string {
	if d.Allow {
		return "ALLOW"
	}
	if len(d.Rules) > 0 {
		return d.Rules[0]
	}
	return "BLOCK"
}

// ReviewInput scans user input. It does not touch the network.
func (p *Policy) ReviewInput(text string) Decision {
	return p.review(StageInput, text)
}

// ReviewOutput scans assistant output (rolling window or full text).
func (p *Policy) ReviewOutput(text string) Decision {
	return p.review(StageOutput, text)
}

func (p *Policy) review(stage Stage, text string) Decision {
	if p == nil {
		p = New()
	}
	hay := strings.ToLower(text)
	var hits []string
	risk := RiskR0
	for _, r := range p.rules {
		if r.stage != stage {
			continue
		}
		hit := false
		for _, phrase := range r.phrases {
			if phrase != "" && strings.Contains(hay, phrase) {
				hit = true
				break
			}
		}
		if !hit && r.hit != nil && r.hit(hay) {
			hit = true
		}
		if hit {
			hits = append(hits, r.id)
			if r.risk.rank() > risk.rank() {
				risk = r.risk
			}
		}
	}
	if len(hits) > 0 {
		return Decision{Allow: false, Risk: risk, Rules: hits}
	}
	return Decision{Allow: true, Risk: RiskR0}
}

// LastRunes returns the trailing window used by rolling review. Exported so
// tests and the companion engine share one tail implementation.
func LastRunes(s string, n int) string {
	if n <= 0 || s == "" {
		return ""
	}
	i := len(s)
	for count := 0; i > 0 && count < n; count++ {
		_, size := utf8.DecodeLastRuneInString(s[:i])
		if size <= 0 {
			break
		}
		i -= size
	}
	return s[i:]
}
