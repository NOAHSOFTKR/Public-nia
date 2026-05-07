"use strict";
/**
 * JSON 파일 기반 DB → MySQL 마이그레이션 스크립트
 *
 * 사용법:
 *   node migrate.js [--dry-run]
 *
 * --dry-run 플래그를 붙이면 실제 DB에 쓰지 않고 이행 대상만 출력합니다.
 *
 * 필요 환경변수 (.env):
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *
 * 마이그레이션 대상:
 *   ./DB/<guildId>/config.json          → guild_configs
 *   ./DB/<guildId>/users/<userId>.json  → user_configs
 *   ./DB/<guildId>/share.json           → share_configs
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const db   = require('./db.js');

const DRY_RUN = process.argv.includes('--dry-run');
const DB_ROOT = path.join(__dirname, 'DB');

/* ── 카운터 ── */
let counts = { guild: 0, user: 0, share: 0, skip: 0, error: 0 };

function tryReadJSON(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

async function migrateGuild(guildId) {
    /* guild_configs */
    const cfgPath = path.join(DB_ROOT, guildId, 'config.json');
    const cfg     = tryReadJSON(cfgPath);

    if (cfg) {
        const guildData = {
            defaultVoice: cfg.defaultVoice ?? 'female',
            defaultSpeed: cfg.defaultSpeed ?? 1.0,
            defaultPitch: cfg.defaultPitch ?? 0
        };
        console.log(`  [guild_configs] ${guildId}  voice=${guildData.defaultVoice} speed=${guildData.defaultSpeed} pitch=${guildData.defaultPitch}`);
        if (!DRY_RUN) {
            await db.pool.execute(
                `INSERT INTO guild_configs (guild_id, default_voice, default_speed, default_pitch) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE default_voice = VALUES(default_voice), default_speed = VALUES(default_speed), default_pitch = VALUES(default_pitch)`,
                [guildId, guildData.defaultVoice, guildData.defaultSpeed, guildData.defaultPitch]
            );
        }
        counts.guild++;
    }

    /* user_configs */
    const usersDir = path.join(DB_ROOT, guildId, 'users');
    if (fs.existsSync(usersDir)) {
        for (const file of fs.readdirSync(usersDir)) {
            if (!file.endsWith('.json')) continue;
            const userId = path.basename(file, '.json');
            const data   = tryReadJSON(path.join(usersDir, file));
            if (!data) { counts.skip++; continue; }

            const userData = {
                voice: data.voice ?? 'female',
                speed: data.speed ?? 1.0,
                pitch: data.pitch ?? 0
            };
            console.log(`  [user_configs]  ${guildId} / ${userId}  voice=${userData.voice} speed=${userData.speed} pitch=${userData.pitch}`);
            if (!DRY_RUN) {
                await db.saveUserConfig(guildId, userId, userData);
            }
            counts.user++;
        }
    }

    /* share_configs */
    const sharePath = path.join(DB_ROOT, guildId, 'share.json');
    const shareData = tryReadJSON(sharePath);
    if (shareData) {
        for (const [shareCode, data] of Object.entries(shareData)) {
            if (!data || typeof data !== 'object') { counts.skip++; continue; }
            const entry = {
                voice: data.voice ?? 'female',
                speed: data.speed ?? 1.0,
                pitch: data.pitch ?? 0
            };
            console.log(`  [share_configs] ${guildId} / code=${shareCode}  voice=${entry.voice} speed=${entry.speed} pitch=${entry.pitch}`);
            if (!DRY_RUN) {
                await db.saveShareConfig(guildId, shareCode, entry);
            }
            counts.share++;
        }
    }
}

async function main() {
    console.log(DRY_RUN ? '=== DRY RUN 모드 (DB에 쓰지 않음) ===' : '=== 마이그레이션 시작 ===');

    if (!fs.existsSync(DB_ROOT)) {
        console.log(`./DB 폴더가 없습니다. 마이그레이션할 데이터가 없습니다.`);
        process.exit(0);
    }

    if (!DRY_RUN) {
        await db.initDB();
        console.log('테이블 초기화 완료\n');
    }

    const guildIds = fs.readdirSync(DB_ROOT).filter(name => {
        return fs.statSync(path.join(DB_ROOT, name)).isDirectory();
    });

    if (guildIds.length === 0) {
        console.log('마이그레이션할 길드 데이터가 없습니다.');
        process.exit(0);
    }

    for (const guildId of guildIds) {
        console.log(`\n▶ Guild: ${guildId}`);
        try {
            await migrateGuild(guildId);
        } catch (e) {
            console.error(`  [ERROR] ${guildId}:`, e.message);
            counts.error++;
        }
    }

    console.log('\n=== 완료 ===');
    console.log(`guild_configs : ${counts.guild}건`);
    console.log(`user_configs  : ${counts.user}건`);
    console.log(`share_configs : ${counts.share}건`);
    console.log(`스킵          : ${counts.skip}건`);
    console.log(`에러          : ${counts.error}건`);

    if (!DRY_RUN) await db.pool.end();
    process.exit(counts.error > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('치명적 오류:', e);
    process.exit(1);
});
