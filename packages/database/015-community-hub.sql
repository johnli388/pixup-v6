ALTER TABLE staff_permissions DROP CONSTRAINT staff_permissions_permission_check;
ALTER TABLE staff_permissions ADD CHECK(permission IN ('rights','warehouse','via','finance','support','audit','identity_admin','community_moderation'));
CREATE TABLE community_profiles (
 user_id text PRIMARY KEY REFERENCES users(id), public_id text UNIQUE NOT NULL,
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 2 AND 60), bio text NOT NULL DEFAULT '' CHECK(length(bio)<=600),
 reply_notifications boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_acceptances (user_id text REFERENCES users(id), version text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,version));
CREATE TABLE community_topics (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL, active boolean NOT NULL DEFAULT true);
INSERT INTO community_topics(id,name,description) VALUES
 ('sports','Sports cards','Players, sets and sports-card collecting experiences.'),
 ('k-pop','K-pop','Photocards, favorite artists and collection stories.'),
 ('original-ip','Original IP and art','Original characters, illustration and creative knowledge.'),
 ('preservation','Storage and preservation','Share experience caring for and storing collectibles.'),
 ('beginners','Beginner questions','A welcoming place to ask and learn about collecting.');
CREATE TABLE community_suggestions (id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),name text NOT NULL,description text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE community_entries (
 id text PRIMARY KEY, author_id text NOT NULL REFERENCES users(id), post_id text REFERENCES community_entries(id), parent_id text REFERENCES community_entries(id),
 type text NOT NULL CHECK(type IN ('discussion','question','guide','story','comment')),
 title text NOT NULL DEFAULT '' CHECK(length(title)<=140), body text NOT NULL CHECK(length(body)<=20000 AND (type<>'comment' OR length(body)<=3000)),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','deleted')),
 moderation text NOT NULL DEFAULT 'pending' CHECK(moderation IN ('pending','visible','hidden','removed')),
 locked boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz(3),
 CHECK((type='comment' AND post_id IS NOT NULL AND title='') OR (type<>'comment' AND post_id IS NULL AND parent_id IS NULL)),
 CHECK(id IS DISTINCT FROM post_id AND id IS DISTINCT FROM parent_id)
);
CREATE INDEX community_feed ON community_entries((COALESCE(published_at,created_at)) DESC,id DESC) WHERE post_id IS NULL;
CREATE INDEX community_thread ON community_entries(post_id,created_at,id);
CREATE INDEX community_author ON community_entries(author_id,updated_at DESC);
CREATE INDEX community_review ON community_entries(moderation,state,updated_at);
CREATE INDEX community_search ON community_entries USING gin(to_tsvector('simple',title || ' ' || body));
CREATE TABLE community_entry_topics (entry_id text REFERENCES community_entries(id), topic_id text REFERENCES community_topics(id), PRIMARY KEY(entry_id,topic_id));
CREATE TABLE community_links (entry_id text REFERENCES community_entries(id),asset_id text REFERENCES assets(id),PRIMARY KEY(entry_id,asset_id));
CREATE TABLE community_revisions (entry_id text REFERENCES community_entries(id),version integer NOT NULL,author_id text NOT NULL REFERENCES users(id),title text NOT NULL,body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(entry_id,version));
CREATE TABLE community_relations (
 user_id text NOT NULL REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('like','save','follow','mute_topic','mute_user')),
 target text NOT NULL, entry_id text REFERENCES community_entries(id),topic_id text REFERENCES community_topics(id),profile_id text REFERENCES community_profiles(public_id),
 PRIMARY KEY(user_id,kind,target),
 CHECK((kind IN ('like','save') AND entry_id=target AND entry_id IS NOT NULL AND topic_id IS NULL AND profile_id IS NULL)
 OR (kind IN ('follow','mute_topic') AND topic_id=target AND topic_id IS NOT NULL AND entry_id IS NULL AND profile_id IS NULL)
 OR (kind='mute_user' AND profile_id=target AND profile_id IS NOT NULL AND entry_id IS NULL AND topic_id IS NULL))
);
CREATE TABLE community_reports (id text PRIMARY KEY,reporter_id text NOT NULL REFERENCES users(id),entry_id text NOT NULL REFERENCES community_entries(id),category text NOT NULL,explanation text NOT NULL,state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX community_active_report ON community_reports(reporter_id,entry_id) WHERE state='open';
CREATE TABLE community_actions (id text PRIMARY KEY,entry_id text NOT NULL REFERENCES community_entries(id),subject_id text NOT NULL REFERENCES users(id),actor_id text NOT NULL REFERENCES users(id),action text NOT NULL,reason text NOT NULL,entry_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CHECK(subject_id<>actor_id));
CREATE TABLE community_sanctions (user_id text PRIMARY KEY REFERENCES users(id),action_id text NOT NULL REFERENCES community_actions(id),until_at timestamptz NOT NULL);
CREATE TABLE community_appeals (id text PRIMARY KEY,action_id text UNIQUE NOT NULL REFERENCES community_actions(id),user_id text NOT NULL REFERENCES users(id),statement text NOT NULL,state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','upheld','overturned')),reviewer_id text REFERENCES users(id),reason text,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE community_requests (user_id text REFERENCES users(id),operation text NOT NULL,key text NOT NULL,hash text NOT NULL,result_id text NOT NULL REFERENCES community_entries(id),PRIMARY KEY(user_id,operation,key));
CREATE TABLE community_quotas (user_id text REFERENCES users(id),bucket text NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),count integer NOT NULL DEFAULT 1,PRIMARY KEY(user_id,bucket));
CREATE TABLE community_notifications (id text PRIMARY KEY,event_id text UNIQUE NOT NULL,user_id text NOT NULL REFERENCES users(id),entry_id text NOT NULL REFERENCES community_entries(id),kind text NOT NULL CHECK(kind IN ('reply','moderation')),created_at timestamptz NOT NULL DEFAULT now());

-- Read helpers avoid recursive RLS checks. Fixed search path; no caller-supplied SQL.
CREATE FUNCTION community_member() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.users WHERE id=current_setting('pixup.actor_id',true) AND closed_at IS NULL)
$$;
CREATE FUNCTION community_moderator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.user_id=u.id WHERE u.id=current_setting('pixup.actor_id',true) AND u.closed_at IS NULL AND u.is_staff AND p.permission='community_moderation')
$$;
CREATE FUNCTION community_visible(eid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.community_entries e JOIN public.users u ON u.id=e.author_id
 WHERE e.id=eid AND u.closed_at IS NULL AND e.state='published' AND e.moderation='visible'
 AND (e.post_id IS NULL OR EXISTS(SELECT 1 FROM public.community_entries p JOIN public.users pu ON pu.id=p.author_id WHERE p.id=e.post_id AND p.post_id IS NULL AND pu.closed_at IS NULL AND p.state='published' AND p.moderation='visible'))
 AND (e.parent_id IS NULL OR EXISTS(SELECT 1 FROM public.community_entries c WHERE c.id=e.parent_id AND c.post_id=e.post_id AND c.parent_id IS NULL AND ((c.state='published' AND c.moderation='visible') OR (c.state='deleted' AND c.moderation NOT IN ('hidden','removed'))))))
$$;
CREATE FUNCTION community_owns(eid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.community_entries WHERE id=eid AND author_id=current_setting('pixup.actor_id',true))
$$;
CREATE FUNCTION community_like_count(eid text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN public.community_member() AND public.community_visible(eid) THEN (SELECT count(*)::integer FROM public.community_relations WHERE entry_id=eid AND kind='like') ELSE 0 END
$$;
CREATE FUNCTION community_validate_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.post_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM community_entries WHERE id=NEW.post_id AND post_id IS NULL) THEN RAISE EXCEPTION 'Comment needs a root post'; END IF;
 IF TG_OP='INSERT' AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM community_entries WHERE id=NEW.parent_id AND post_id=NEW.post_id AND parent_id IS NULL) THEN RAISE EXCEPTION 'Reply needs a root comment in this post'; END IF;
 IF TG_OP='UPDATE' AND (NEW.author_id,NEW.post_id,NEW.parent_id,NEW.type) IS DISTINCT FROM (OLD.author_id,OLD.post_id,OLD.parent_id,OLD.type) THEN RAISE EXCEPTION 'Entry ownership and thread are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER community_entry_shape BEFORE INSERT OR UPDATE ON community_entries FOR EACH ROW EXECUTE FUNCTION community_validate_entry();

ALTER TABLE community_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY community_entry_read ON community_entries FOR SELECT USING(pixup_worker() OR community_moderator() OR author_id=current_setting('pixup.actor_id',true) OR (community_member() AND (community_visible(id) OR (state='deleted' AND post_id IS NOT NULL AND community_visible(post_id)))));
CREATE POLICY community_entry_insert ON community_entries FOR INSERT WITH CHECK(community_member() AND author_id=current_setting('pixup.actor_id',true));
CREATE POLICY community_entry_update ON community_entries FOR UPDATE USING(pixup_worker() OR community_moderator() OR author_id=current_setting('pixup.actor_id',true)) WITH CHECK(pixup_worker() OR community_moderator() OR author_id=current_setting('pixup.actor_id',true));
ALTER TABLE community_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY community_profile_read ON community_profiles FOR SELECT USING(community_member() OR pixup_worker());
CREATE POLICY community_profile_write ON community_profiles FOR ALL USING(user_id=current_setting('pixup.actor_id',true) OR pixup_worker()) WITH CHECK(user_id=current_setting('pixup.actor_id',true));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['community_acceptances','community_relations','community_requests','community_quotas','community_notifications'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY own_records ON %I FOR ALL USING(user_id=current_setting(''pixup.actor_id'',true) OR pixup_worker()) WITH CHECK(user_id=current_setting(''pixup.actor_id'',true) OR pixup_worker())',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['community_entry_topics','community_links'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY reference_read ON %I FOR SELECT USING(pixup_worker() OR community_moderator() OR community_owns(entry_id) OR (community_member() AND community_visible(entry_id)))',t);
 EXECUTE format('CREATE POLICY reference_write ON %I FOR ALL USING(community_owns(entry_id)) WITH CHECK(community_owns(entry_id))',t);
 END LOOP;
END $$;
ALTER TABLE community_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY topic_read ON community_topics FOR SELECT USING(community_member() OR pixup_worker());
CREATE POLICY topic_admin ON community_topics FOR ALL USING(community_moderator()) WITH CHECK(community_moderator());
ALTER TABLE community_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY suggestion_access ON community_suggestions FOR ALL USING(user_id=current_setting('pixup.actor_id',true) OR community_moderator()) WITH CHECK(user_id=current_setting('pixup.actor_id',true));
ALTER TABLE community_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY revision_access ON community_revisions FOR ALL USING(author_id=current_setting('pixup.actor_id',true) OR community_moderator() OR pixup_worker()) WITH CHECK(author_id=current_setting('pixup.actor_id',true) OR community_moderator());
ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_access ON community_reports FOR ALL USING(reporter_id=current_setting('pixup.actor_id',true) OR community_moderator() OR pixup_worker()) WITH CHECK(reporter_id=current_setting('pixup.actor_id',true) OR community_moderator());
ALTER TABLE community_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY action_read ON community_actions FOR SELECT USING(subject_id=current_setting('pixup.actor_id',true) OR community_moderator() OR pixup_worker());
CREATE POLICY action_insert ON community_actions FOR INSERT WITH CHECK(community_moderator() AND actor_id=current_setting('pixup.actor_id',true));
ALTER TABLE community_sanctions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sanction_read ON community_sanctions FOR SELECT USING(user_id=current_setting('pixup.actor_id',true) OR community_moderator() OR pixup_worker());
CREATE POLICY sanction_write ON community_sanctions FOR ALL USING(community_moderator()) WITH CHECK(community_moderator());
ALTER TABLE community_appeals ENABLE ROW LEVEL SECURITY;
CREATE POLICY appeal_access ON community_appeals FOR ALL USING(user_id=current_setting('pixup.actor_id',true) OR community_moderator() OR pixup_worker()) WITH CHECK(user_id=current_setting('pixup.actor_id',true) OR community_moderator());

CREATE POLICY acceptance_review ON community_acceptances FOR SELECT USING(community_moderator());

-- Support may erase a closed account's community data, but cannot read private drafts.
CREATE FUNCTION community_close(uid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.user_id=u.id WHERE u.id=current_setting('pixup.actor_id',true) AND u.is_staff AND u.closed_at IS NULL AND p.permission='support') OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=uid AND closed_at IS NOT NULL) THEN RAISE EXCEPTION 'Community closure requires support and a closed account'; END IF;
 PERFORM id FROM public.community_entries WHERE author_id=uid ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.community_reports r JOIN public.community_entries e ON e.id=r.entry_id WHERE r.state='open' AND (e.author_id=uid OR r.reporter_id=uid)) OR EXISTS(SELECT 1 FROM public.community_appeals WHERE user_id=uid AND state='open') THEN RAISE EXCEPTION 'Resolve community reports and appeals before closure'; END IF;
 UPDATE public.community_entries SET state='deleted',title='',body='',version=version+1,updated_at=now() WHERE author_id=uid;
 DELETE FROM public.community_revisions WHERE author_id=uid;
 DELETE FROM public.community_relations WHERE user_id=uid OR profile_id IN (SELECT public_id FROM public.community_profiles WHERE user_id=uid);
 DELETE FROM public.community_notifications WHERE user_id=uid;
 DELETE FROM public.community_suggestions WHERE user_id=uid;
 DELETE FROM public.community_acceptances WHERE user_id=uid;
 UPDATE public.community_profiles SET display_name='Deleted member',bio='',reply_notifications=false WHERE user_id=uid;
 UPDATE public.community_reports SET explanation='Deleted account report' WHERE reporter_id=uid;
 UPDATE public.community_appeals SET statement='Deleted account appeal' WHERE user_id=uid;
END $$;

-- Row locking is separate from UPDATE authority: members can serialize against a
-- visible thread without receiving permission to edit another author's row.
CREATE FUNCTION community_lock_entry(eid text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.community_member() THEN RETURN false; END IF;
 PERFORM id FROM public.community_entries e WHERE e.id=eid AND
 (e.author_id=current_setting('pixup.actor_id',true) OR public.community_moderator() OR public.community_visible(e.id)
 OR EXISTS(SELECT 1 FROM public.community_entries child WHERE child.post_id=e.id AND child.author_id=current_setting('pixup.actor_id',true))) FOR UPDATE;
 RETURN FOUND;
END $$;
CREATE FUNCTION community_lock_topic(tid text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.community_member() THEN RETURN false; END IF;
 PERFORM id FROM public.community_topics WHERE id=tid FOR SHARE;
 RETURN FOUND;
END $$;
