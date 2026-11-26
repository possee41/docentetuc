-- EXPERIMENT LOCAL ONLY. Not a numbered migration; never executed remotely.
-- All public and sync mutations invalidate, including deletes and same-second edits.
CREATE TABLE public_snapshot_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO public_snapshot_revision VALUES (1, 0);
CREATE TRIGGER public_snapshot_pub_insert AFTER INSERT ON publications BEGIN UPDATE public_snapshot_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER public_snapshot_pub_update AFTER UPDATE ON publications BEGIN UPDATE public_snapshot_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER public_snapshot_pub_delete AFTER DELETE ON publications BEGIN UPDATE public_snapshot_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER public_snapshot_sync_insert AFTER INSERT ON sync_state BEGIN UPDATE public_snapshot_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER public_snapshot_sync_update AFTER UPDATE ON sync_state BEGIN UPDATE public_snapshot_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER public_snapshot_sync_delete AFTER DELETE ON sync_state BEGIN UPDATE public_snapshot_revision SET revision=revision+1 WHERE id=1; END;
