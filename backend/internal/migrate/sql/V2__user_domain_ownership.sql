-- TASK-0015 V2: user-domain core tables with composite ownership foreign keys,
-- FORCE ROW LEVEL SECURITY and explicit owner predicates.
--
-- Composite ownership pattern: every owned table carries owner_user_id and a
-- composite primary key (owner_user_id, id). Children reference parents through
-- (owner_user_id, parent_id) foreign keys, so a row can never point at a parent
-- owned by a different user regardless of any application bug.
--
-- Chains covered (specs/contracts/database-ownership-contract.yaml):
--   user -> relationship -> conversation -> message
--   user -> relationship -> conversation -> generation
--   user -> relationship -> conversation -> generation -> route
--   user -> relationship -> conversation -> generation -> attempt
--   user -> relationship -> conversation -> generation -> candidate
--   user -> relationship -> memory -> evidence

SET search_path TO vc, public;

-- Ownership root. RLS uses the identity column itself as the owner predicate.
CREATE TABLE IF NOT EXISTS vc.vc_user (
    id              bigint PRIMARY KEY,
    display_name    text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vc.relationship (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    persona_ref     text NOT NULL,
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vc.conversation (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    relationship_id bigint NOT NULL,
    title           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vc.message (
    owner_user_id    bigint NOT NULL,
    id               bigint NOT NULL,
    conversation_id  bigint NOT NULL,
    role             text NOT NULL,
    content          text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, conversation_id)
        REFERENCES vc.conversation(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vc.generation (
    owner_user_id    bigint NOT NULL,
    id               bigint NOT NULL,
    conversation_id  bigint NOT NULL,
    -- INV-GEN-001: one logical request has one stable generation id, scoped
    -- per owner so two owners may reuse the same logical label independently.
    logical_generation_id text NOT NULL,
    status           text NOT NULL DEFAULT 'PENDING',
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, conversation_id)
        REFERENCES vc.conversation(owner_user_id, id) ON DELETE CASCADE,
    UNIQUE (owner_user_id, logical_generation_id)
);

CREATE TABLE IF NOT EXISTS vc.generation_route (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    generation_id   bigint NOT NULL,
    decision_no     integer NOT NULL,
    provider_ref    text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vc.generation_attempt (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    generation_id   bigint NOT NULL,
    provider_ref    text NOT NULL,
    outcome         text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vc.generation_candidate (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    generation_id   bigint NOT NULL,
    content         text NOT NULL,
    -- INV-GEN-002: at most one final assistant message per generation.
    is_final        boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE
);

-- Partial unique index enforces "at most one final candidate per generation".
CREATE UNIQUE INDEX IF NOT EXISTS generation_candidate_one_final
    ON vc.generation_candidate (owner_user_id, generation_id)
    WHERE is_final;

CREATE TABLE IF NOT EXISTS vc.memory_item (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    relationship_id bigint NOT NULL,
    scope           text NOT NULL,
    summary         text NOT NULL,
    status          text NOT NULL DEFAULT 'PENDING',
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vc.memory_evidence (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    memory_item_id  bigint NOT NULL,
    source_ref      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, memory_item_id)
        REFERENCES vc.memory_item(owner_user_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- FORCE ROW LEVEL SECURITY on every owned table. FORCE is load-bearing: it
-- binds even the table owner, so only an explicit BYPASSRLS principal (never
-- a runtime role) can escape isolation. Runtime roles are NOBYPASSRLS (V1).
-- A missing tenant context (vc.current_owner_id() IS NULL) matches nothing,
-- so every policy fails closed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t text;
    owned text[] := ARRAY[
        'vc_user','relationship','conversation','message','generation',
        'generation_route','generation_attempt','generation_candidate',
        'memory_item','memory_evidence'
    ];
    predicate text;
BEGIN
    FOREACH t IN ARRAY owned LOOP
        EXECUTE format('ALTER TABLE vc.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE vc.%I FORCE ROW LEVEL SECURITY', t);
        IF t = 'vc_user' THEN
            predicate := 'id = vc.current_owner_id()';
        ELSE
            predicate := 'owner_user_id = vc.current_owner_id()';
        END IF;
        EXECUTE format(
            'DROP POLICY IF EXISTS owner_isolation ON vc.%I', t
        );
        EXECUTE format(
            'CREATE POLICY owner_isolation ON vc.%I FOR ALL '
            'TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher '
            'USING (%s) WITH CHECK (%s)',
            t, predicate, predicate
        );
    END LOOP;
END $$;

-- Minimal DML privileges for the four runtime roles. No table is granted to
-- PUBLIC and no runtime role receives BYPASSRLS or REFERENCES (FK integrity is
-- structural; the application never creates foreign keys at runtime).
GRANT USAGE ON SCHEMA vc TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON vc.vc_user, vc.relationship, vc.conversation, vc.message, vc.generation,
       vc.generation_route, vc.generation_attempt, vc.generation_candidate,
       vc.memory_item, vc.memory_evidence
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
