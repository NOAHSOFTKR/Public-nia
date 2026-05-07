"use strict";
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host:     process.env.DB_HOST ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '3306'),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4'
});

async function initDB() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS guild_configs (
            guild_id     VARCHAR(20)  NOT NULL PRIMARY KEY,
            default_voice VARCHAR(20) NOT NULL DEFAULT 'female',
            default_speed FLOAT       NOT NULL DEFAULT 1.0,
            default_pitch FLOAT       NOT NULL DEFAULT 0
        ) CHARACTER SET utf8mb4
    `);
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS user_configs (
            guild_id VARCHAR(20) NOT NULL,
            user_id  VARCHAR(20) NOT NULL,
            voice    VARCHAR(20) NOT NULL DEFAULT 'female',
            speed    FLOAT       NOT NULL DEFAULT 1.0,
            pitch    FLOAT       NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, user_id)
        ) CHARACTER SET utf8mb4
    `);
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS share_configs (
            guild_id   VARCHAR(20) NOT NULL,
            share_code VARCHAR(20) NOT NULL,
            voice      VARCHAR(20) NOT NULL DEFAULT 'female',
            speed      FLOAT       NOT NULL DEFAULT 1.0,
            pitch      FLOAT       NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, share_code)
        ) CHARACTER SET utf8mb4
    `);
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS blacklist (
            user_id  VARCHAR(20) NOT NULL PRIMARY KEY,
            reason   TEXT,
            added_by VARCHAR(20) NOT NULL,
            added_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4
    `);
}

async function getGuildConfig(guildId) {
    const [rows] = await pool.execute(
        'SELECT default_voice, default_speed, default_pitch FROM guild_configs WHERE guild_id = ?',
        [guildId]
    );
    if (rows.length === 0) {
        await pool.execute('INSERT IGNORE INTO guild_configs (guild_id) VALUES (?)', [guildId]);
        return { defaultVoice: 'female', defaultSpeed: 1.0, defaultPitch: 0 };
    }
    return {
        defaultVoice: rows[0].default_voice,
        defaultSpeed: rows[0].default_speed,
        defaultPitch: rows[0].default_pitch
    };
}

async function getUserConfig(guildId, userId) {
    const [rows] = await pool.execute(
        'SELECT voice, speed, pitch FROM user_configs WHERE guild_id = ? AND user_id = ?',
        [guildId, userId]
    );
    if (rows.length === 0) {
        const guild = await getGuildConfig(guildId);
        return { voice: guild.defaultVoice, speed: guild.defaultSpeed, pitch: guild.defaultPitch };
    }
    return { voice: rows[0].voice, speed: rows[0].speed, pitch: rows[0].pitch };
}

async function saveUserConfig(guildId, userId, data) {
    await pool.execute(
        `INSERT INTO user_configs (guild_id, user_id, voice, speed, pitch) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE voice = VALUES(voice), speed = VALUES(speed), pitch = VALUES(pitch)`,
        [guildId, userId, data.voice, data.speed, data.pitch]
    );
}

async function getShareConfig(guildId, shareCode) {
    const [rows] = await pool.execute(
        'SELECT voice, speed, pitch FROM share_configs WHERE guild_id = ? AND share_code = ?',
        [guildId, shareCode]
    );
    return rows.length ? { voice: rows[0].voice, speed: rows[0].speed, pitch: rows[0].pitch } : null;
}

async function saveShareConfig(guildId, shareCode, data) {
    await pool.execute(
        `INSERT INTO share_configs (guild_id, share_code, voice, speed, pitch) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE voice = VALUES(voice), speed = VALUES(speed), pitch = VALUES(pitch)`,
        [guildId, shareCode, data.voice, data.speed, data.pitch]
    );
}

async function isBlacklisted(userId) {
    const [rows] = await pool.execute(
        'SELECT 1 FROM blacklist WHERE user_id = ?', [userId]
    );
    return rows.length > 0;
}

async function addBlacklist(userId, reason, addedBy) {
    await pool.execute(
        `INSERT INTO blacklist (user_id, reason, added_by) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reason = VALUES(reason), added_by = VALUES(added_by), added_at = NOW()`,
        [userId, reason ?? '사유 없음', addedBy]
    );
}

async function removeBlacklist(userId) {
    const [result] = await pool.execute('DELETE FROM blacklist WHERE user_id = ?', [userId]);
    return result.affectedRows > 0;
}

async function listBlacklist() {
    const [rows] = await pool.execute('SELECT * FROM blacklist ORDER BY added_at DESC');
    return rows;
}

module.exports = {
    pool,
    initDB,
    getGuildConfig,
    getUserConfig,
    saveUserConfig,
    getShareConfig,
    saveShareConfig,
    isBlacklisted,
    addBlacklist,
    removeBlacklist,
    listBlacklist
};
