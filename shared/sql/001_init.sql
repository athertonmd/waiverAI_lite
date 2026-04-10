-- 001_init.sql — Initial schema for Waiver Data Hub Lite

CREATE TABLE waivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    airline_code VARCHAR(2) NOT NULL,
    waiver_title VARCHAR(500) NOT NULL,
    waiver_code VARCHAR(100) NOT NULL,
    effective_date DATE NOT NULL,
    expiration_date DATE NOT NULL,
    applicable_routes JSONB DEFAULT '[]',
    fare_classes JSONB DEFAULT '[]',
    rebooking_rules TEXT,
    refund_rules TEXT,
    confidence_scores JSONB NOT NULL,
    overall_confidence NUMERIC(3,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending_review',
    source_type VARCHAR(10) NOT NULL,
    source_s3_key VARCHAR(1024) NOT NULL,
    normalized_s3_key VARCHAR(1024),
    ingestion_timestamp TIMESTAMPTZ NOT NULL,
    extraction_timestamp TIMESTAMPTZ,
    approval_timestamp TIMESTAMPTZ,
    reviewer_id VARCHAR(100),
    rejection_reason TEXT,
    version_number INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_airline_waiver_date UNIQUE (airline_code, waiver_code, effective_date)
);

CREATE TABLE waiver_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    waiver_id UUID NOT NULL REFERENCES waivers(id),
    version_number INTEGER NOT NULL,
    data JSONB NOT NULL,
    changed_by VARCHAR(100),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE monitor_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    url_hash VARCHAR(64) NOT NULL,
    interval_minutes INTEGER NOT NULL,
    end_date_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_content_hash VARCHAR(64),
    last_fetch_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE web_content_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES monitor_schedules(id),
    s3_key VARCHAR(1024) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    change_detected BOOLEAN NOT NULL DEFAULT FALSE,
    high_impact BOOLEAN NOT NULL DEFAULT FALSE,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES ('confidence_threshold', '0.85');

CREATE INDEX idx_waivers_status ON waivers(status);
CREATE INDEX idx_waivers_airline ON waivers(airline_code);
CREATE INDEX idx_waivers_confidence ON waivers(overall_confidence);
CREATE INDEX idx_waivers_expiration ON waivers(expiration_date);
CREATE INDEX idx_waiver_versions_waiver_id ON waiver_versions(waiver_id);
CREATE INDEX idx_monitor_schedules_status ON monitor_schedules(status);
CREATE INDEX idx_web_content_versions_schedule ON web_content_versions(schedule_id);
