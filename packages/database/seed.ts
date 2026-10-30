import type { Database } from './index';
import { one } from './index';
import { passwordHash } from '../domain/security';
import { id, provenance, journal } from '../domain/core';
import { staffPermissions } from '../domain/contracts';

export async function seed(db: Database) {
  if (await one(db, "SELECT id FROM users WHERE id='collector'")) return;
  const password = await passwordHash('PixupDemo2026!');
  await db.transaction(async (tx) => {
    for (const [uid, name, staff] of [
      ['collector', 'Alex Morgan', false],
      ['creator', 'Studio Orbit', false],
      ['seller', 'Archive House', false],
      ['ops', 'PixUP Operations', true],
      ['platform', 'PixUP Editions', false],
    ] as const) {
      await tx.query(
        'INSERT INTO users(id,email,name,password_hash,is_staff) VALUES ($1,$2,$3,$4,$5)',
        [uid, `${uid}@pixup.demo`, name, password, staff],
      );
      await tx.query('INSERT INTO organizations(id,name,kind) VALUES ($1,$2,$3)', [
        `${uid}-org`,
        name,
        uid === 'creator' ? 'creator' : uid === 'platform' ? 'platform' : 'personal',
      ]);
      await tx.query("INSERT INTO memberships(user_id,org_id,role) VALUES ($1,$2,'owner')", [
        uid,
        `${uid}-org`,
      ]);
      if (staff)
        for (const permission of staffPermissions)
          await tx.query('INSERT INTO staff_permissions(user_id,permission) VALUES ($1,$2)', [
            uid,
            permission,
          ]);
    }
    const collections = [
      [
        'court-culture',
        'Court Culture',
        'Sports',
        'An ode to the game. Original player studies, captured in a limited collectible edition.',
        'court',
        'agency',
      ],
      [
        'after-hours',
        'After Hours',
        'K-pop',
        'A fictional pop universe in chrome, violet and late-night light. Original concept art by Studio Orbit.',
        'idol',
        'platform',
      ],
      [
        'future-forms',
        'Future Forms',
        'Art',
        'Objects from another tomorrow. A study in color, form, and the joy of collecting.',
        'orbit',
        'platform',
      ],
      [
        'pixel-worlds',
        'Pixel Worlds',
        'Gaming',
        'Little worlds. Big adventures. Original characters from a world built one pixel at a time.',
        'pixel',
        'own',
      ],
    ];
    for (const [cid, title, category, description, artwork, mode] of collections) {
      await tx.query(
        "INSERT INTO collections(id,org_id,title,description,category,edition_size,status,rights_evidence,artwork,issuance_mode) VALUES ($1,'creator-org',$2,$3,$4,250,'published',$5,$6,$7)",
        [
          cid,
          title,
          description,
          category,
          'Original demonstration artwork. Not a licensed third-party release.',
          artwork,
          mode,
        ],
      );
    }
    const assets = [
      [
        'court-01',
        'court-culture',
        'Above the Rim · Rookie Edition',
        'court',
        'Sports',
        12500,
        '9.5',
        'platform',
      ],
      [
        'idol-01',
        'after-hours',
        'LUNA · Midnight Holographic',
        'idol',
        'K-pop',
        8500,
        '10',
        'seller',
      ],
      ['orbit-01', 'future-forms', 'Orbital No. 04', 'orbit', 'Art', 6500, '9.5', 'platform'],
      [
        'pixel-01',
        'pixel-worlds',
        'Cloud Runner · First Edition',
        'pixel',
        'Gaming',
        4500,
        '9',
        'platform',
      ],
      [
        'court-02',
        'court-culture',
        'Courtside · The Finals',
        'court2',
        'Sports',
        18000,
        '10',
        'seller',
      ],
      [
        'idol-02',
        'after-hours',
        'NEON · Backstage Pass',
        'idol2',
        'K-pop',
        7200,
        '9.5',
        'platform',
      ],
      ['orbit-02', 'future-forms', 'Soft Geometry · Cyan', 'orbit2', 'Art', 9500, '10', 'seller'],
      [
        'pixel-02',
        'pixel-worlds',
        'Forest Spirit · Foil Edition',
        'pixel2',
        'Gaming',
        3800,
        '9',
        'platform',
      ],
      [
        'court-03',
        'court-culture',
        'Full Court · Silver Parallel',
        'court',
        'Sports',
        5800,
        '9',
        'platform',
      ],
      ['idol-03', 'after-hours', 'LUNA · The Encore', 'idol2', 'K-pop', 11000, '10', 'seller'],
      [
        'owned-01',
        'future-forms',
        'Orbital No. 02 · Personal Edition',
        'orbit2',
        'Art',
        0,
        '9.5',
        'collector',
      ],
      [
        'owned-02',
        'court-culture',
        'Courtside · Opening Night',
        'court2',
        'Sports',
        0,
        '9',
        'collector',
      ],
      ['seller-01', 'after-hours', 'NEON · Daybreak Edition', 'idol', 'K-pop', 0, '10', 'seller'],
    ] as const;
    for (let i = 0; i < assets.length; i++) {
      const [aid, cid, title, artwork, category, price, grade, owner] = assets[i];
      await tx.query(
        "INSERT INTO assets(id,collection_id,owner_id,title,category,serial,artwork,description,grade,certification,custody,platform_owned,edition_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified','vault',$10,$11)",
        [
          aid,
          cid,
          owner,
          title,
          category,
          `PX-2026-${String(i + 1).padStart(5, '0')}`,
          artwork,
          'Original demo collectible. Individually registered, photographed, and held in the PixUP demonstration vault.',
          grade,
          owner === 'platform',
          i + 1,
        ],
      );
      const assessment = id();
      await tx.query(
        "INSERT INTO assessments(id,asset_id,reviewer_id,result,grade,evidence) VALUES ($1,$2,'ops','verified',$3,$4)",
        [assessment, aid, grade, 'Demo assessment only. No real physical item was authenticated.'],
      );
      await tx.query('INSERT INTO certificates(id,asset_id,assessment_id) VALUES ($1,$2,$3)', [
        `VIA-${String(i + 1).padStart(6, '0')}`,
        aid,
        assessment,
      ]);
      await provenance(
        tx,
        aid,
        'creator',
        'registered',
        'Edition and specimen registered in the demo catalog.',
      );
      await provenance(
        tx,
        aid,
        'ops',
        'authenticated',
        `VIA demo assessment completed. Condition: ${grade}.`,
      );
      await provenance(tx, aid, 'ops', 'vault_received', 'Received into the demonstration vault.');
      if (price)
        await tx.query(
          'INSERT INTO listings(id,asset_id,seller_id,price_cents) VALUES ($1,$2,$3,$4)',
          [`listing-${aid}`, aid, owner, price],
        );
    }
    await tx.query(
      "INSERT INTO credit_lots(id,user_id,issued,available,origin) VALUES ('welcome-credits','collector',1200,1200,'Demo welcome grant')",
    );
    await journal(tx, 'demo-welcome', 'CREDIT', 'Demo welcome credits', [
      ['credit_issuance', 1200],
      ['credits:collector', -1200],
    ]);
    await tx.query(
      "INSERT INTO activity(id,user_id,title,body) VALUES ($1,'collector','Welcome to your collection','Your two demo collectibles are safely in the vault. Explore, sell, or recirculate them.')",
      [id()],
    );
  });
}
