BEGIN;

CREATE TABLE IF NOT EXISTS public.user_service_balances (
    balance_id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    service_type TEXT NOT NULL,
    balance INTEGER DEFAULT 0 NOT NULL,
    last_updated_by_actor_type TEXT NOT NULL,
    last_updated_by_actor_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT ck_user_service_balance_non_negative CHECK (balance >= 0),
    CONSTRAINT ux_user_service_balance UNIQUE (user_id, service_type)
);

CREATE TABLE IF NOT EXISTS public.user_service_transactions (
    transaction_id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    service_type TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    idempotency_key TEXT,
    project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
    request_id TEXT,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT ck_user_service_transaction_non_zero CHECK (delta <> 0)
);

CREATE INDEX IF NOT EXISTS ix_user_service_balances_user_id
    ON public.user_service_balances(user_id);
CREATE INDEX IF NOT EXISTS ix_user_service_balances_service_type
    ON public.user_service_balances(service_type);

CREATE INDEX IF NOT EXISTS ix_user_service_transactions_user_id
    ON public.user_service_transactions(user_id);
CREATE INDEX IF NOT EXISTS ix_user_service_transactions_service_type
    ON public.user_service_transactions(service_type);
CREATE INDEX IF NOT EXISTS ix_user_service_transactions_project_id
    ON public.user_service_transactions(project_id);
CREATE INDEX IF NOT EXISTS ix_user_service_transactions_request_id
    ON public.user_service_transactions(request_id);
CREATE INDEX IF NOT EXISTS ix_user_service_transactions_idempotency_key
    ON public.user_service_transactions(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_service_transactions_idempotency_key
    ON public.user_service_transactions(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.user_service_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_service_transactions ENABLE ROW LEVEL SECURITY;

COMMIT;
