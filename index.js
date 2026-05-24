"use strict";
require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const util   = require('util');
const crypto = require('crypto');
const { replaceall } = require("./replace.js");

const db = require('./db.js');

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    Events,
    ChannelType,
    PermissionsBitField
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    getVoiceConnection
} = require('@discordjs/voice');

const textToSpeech = require('@google-cloud/text-to-speech');
const { josa } = require('es-hangul');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const ttsClient = new textToSpeech.TextToSpeechClient();

/** @type {import('discord.js').User} */
let dev = null;

/* ===================== 음성 목록 ===================== */

const voices = {
    female: 'ko-KR-Standard-A',
    male:   'ko-KR-Standard-B',
    calm:   'ko-KR-Wavenet-A'
};

/* ===================== 전역 상태 ===================== */

const queues          = {};  // queues[guildId][textChannelId]
const players         = {};  // players[guildId]
const playing         = {};  // playing[guildId]
const targetTextChannel = {}; // guildId -> channelId

/* ===================== 큐 ===================== */

function getQueue(guildId, channelId) {
    queues[guildId] ??= {};
    queues[guildId][channelId] ??= [];
    return queues[guildId][channelId];
}

/* ===================== TTS 재생 ===================== */

async function processQueue(guildId, channelId) {
    if (playing[guildId]) return;

    const queue = getQueue(guildId, channelId);
    if (queue.length === 0) return;

    playing[guildId] = true;
    players[guildId] ??= createAudioPlayer();

    const { text, userId } = queue.shift();
    const setting = await db.getUserConfig(guildId, userId);

    const request = {
        input: { text },
        voice: {
            languageCode: 'ko-KR',
            name: voices[setting.voice] ?? voices.female
        },
        audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: setting.speed,
            pitch: setting.pitch
        }
    };

    try {
        const [res] = await ttsClient.synthesizeSpeech(request);
        const file = `./tts_${Date.now()}_${guildId}.mp3`;
        await util.promisify(fs.writeFile)(file, res.audioContent, 'binary');

        try {
            players[guildId].play(createAudioResource(file));
        } catch (e) {
            fs.existsSync(file) && fs.unlinkSync(file);
            throw e;
        }

        players[guildId].once(AudioPlayerStatus.Idle, () => {
            fs.existsSync(file) && fs.unlinkSync(file);
            playing[guildId] = false;
            processQueue(guildId, channelId);
        });
    } catch (e) {
        console.error(e);
        playing[guildId] = false;
    }
}

/* ===================== 로그 ===================== */

async function log(filepath, text) {
    let data = '';
    try { data = await fs.promises.readFile(filepath, 'utf8'); } catch { /* 파일 없으면 빈 문자열 */ }
    await fs.promises.writeFile(filepath, data + '\n' + text);
}

/* ===================== Slash Commands ===================== */

const commands = [
    new SlashCommandBuilder()
        .setName('들어와')
        .setDescription('음성 채널에 들어갑니다.'),

    new SlashCommandBuilder()
        .setName('나가')
        .setDescription('음성 채널에서 나옵니다.'),

    new SlashCommandBuilder()
        .setName('설정공유')
        .setDescription('설정공유')
        .addSubcommand(sub => sub
            .setName('공유')
            .setDescription('자신의 TTS 설정을 공유합니다.')
        )
        .addSubcommand(sub => sub
            .setName('적용')
            .setDescription('다른 사람의 TTS 설정을 적용합니다.')
            .addStringOption(o => o
                .setName('공유코드')
                .setDescription('다른 사람이 공유해준 공유코드를 입력하세요.')
                .setRequired(true)
            )
        ),

    new SlashCommandBuilder()
        .setName('설정')
        .setDescription('TTS 설정')
        .addStringOption(o => o
            .setName('음성')
            .setDescription('목소리 종류를 선택하세요.')
            .addChoices(
                { name: '1 (여성)', value: 'female' },
                { name: '2 (남성)', value: 'male' },
                { name: '3 (잔잔)', value: 'calm' }
            )
        )
        .addNumberOption(o => o
            .setName('속도')
            .setDescription('말하기 속도 (0.25 ~ 4.0)')
            .setMinValue(0.25)
            .setMaxValue(4.0)
        )
        .addNumberOption(o => o
            .setName('피치')
            .setDescription('목소리 높낮이 (-20 ~ 20)')
            .setMinValue(-20)
            .setMaxValue(20)
        ),

    new SlashCommandBuilder()
        .setName('이동')
        .setDescription('멤버나 자기자신을 다른 음성채널로 이동시킵니다.')
        .addChannelOption(o => o
            .setName('채널')
            .setDescription('이동할 채널을 선택해주세요')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
        .addUserOption(o => o
            .setName('대상')
            .setDescription('이동시킬 대상, 미선택시 자기자신')
            .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('개발자')
        .setDescription('개발자 전용 명령어')
        .addSubcommand(sub => sub
            .setName('공지')
            .setDescription('공지를 보냅니다')
            .addStringOption(o => o
                .setChoices(
                    { name: '서버주인에게만', value: 'onlyserverowner' },
                    { name: '음성채널에',     value: 'voicechannel' }
                )
                .setName('전송대상')
                .setDescription('전송대상을 선택하세요')
                .setRequired(true)
            )
            .addStringOption(o => o
                .setName('내용')
                .setDescription('공지의 내용')
                .setMinLength(1)
                .setMaxLength(2000)
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('들어가')
            .setDescription('특정채널에 봇을 강제로 참여시킵니다')
            .addChannelOption(o => o
                .setName('음성채널')
                .setDescription('들어갈 음성채널')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                .setRequired(true)
            )
            .addChannelOption(o => o
                .setName('채팅채널')
                .setDescription('읽어줄 일반채널')
                .addChannelTypes(
                    ChannelType.GuildText,
                    ChannelType.PublicThread,
                    ChannelType.PrivateThread,
                    ChannelType.GuildVoice,
                    ChannelType.GuildStageVoice
                )
                .setRequired(true)
            )
        )
        .addSubcommandGroup(group => group
            .setName('블랙리스트')
            .setDescription('블랙리스트 관리')
            .addSubcommand(sub => sub
                .setName('추가')
                .setDescription('유저를 블랙리스트에 추가합니다')
                .addUserOption(o => o
                    .setName('유저')
                    .setDescription('블랙리스트에 추가할 유저')
                    .setRequired(true)
                )
                .addStringOption(o => o
                    .setName('사유')
                    .setDescription('블랙리스트 추가 사유')
                    .setRequired(false)
                )
            )
            .addSubcommand(sub => sub
                .setName('제거')
                .setDescription('유저를 블랙리스트에서 제거합니다')
                .addUserOption(o => o
                    .setName('유저')
                    .setDescription('블랙리스트에서 제거할 유저')
                    .setRequired(true)
                )
            )
            .addSubcommand(sub => sub
                .setName('목록')
                .setDescription('블랙리스트 목록을 확인합니다')
            )
        )
];

/* ===================== Discord Client ===================== */

client.once(Events.ClientReady, async () => {
    await db.initDB();
    await client.application.commands.set(commands);
    console.log('Bot is ready!');
    dev = await client.users.fetch(process.env.devId);
});

/* ===================== Guild Join ===================== */

client.on(Events.GuildCreate, async (guild) => {
    try {
        await (await guild.members.fetch(guild.ownerId)).send('저는 TTS봇입니다. 추가되었어요!');
    } catch (e) {
        console.error(`[GuildCreate] DM 전송 실패 (${guild.id}):`, e);
    }
});

/* ===================== Interaction ===================== */

client.on(Events.InteractionCreate, async i => {
    if (!i.isChatInputCommand()) return;
    await log('log.log', `[${Math.floor(Date.now() / 1000)}] ${i.user.id} used ${i.commandName}`);

    /* ── 들어와 ── */
    if (i.commandName === '들어와') {
        const vc = i.member.voice.channel;
        if (!vc) return i.reply({ content: '음성 채널에 먼저 들어가세요.', ephemeral: true });

        const conn = joinVoiceChannel({
            channelId:       vc.id,
            guildId:         vc.guild.id,
            adapterCreator:  vc.guild.voiceAdapterCreator
        });

        players[i.guildId] ??= createAudioPlayer();
        conn.subscribe(players[i.guildId]);
        targetTextChannel[i.guildId] = i.channelId;
        await i.guild.members.me.voice?.setDeaf(true);

        return i.reply({ content: '음성 채널에 접속했습니다.', ephemeral: true });
    }

    /* ── 나가 ── */
    if (i.commandName === '나가') {
        const conn = getVoiceConnection(i.guildId);
        if (!conn) return i.reply({ content: '봇이 음성 채널에 없습니다.', ephemeral: true });
        if (i.member.voice.channel?.id !== conn.joinConfig.channelId)
            return i.reply({ content: '음성채널에 들어가야지 봇을 퇴장시킬 수 있습니다.', flags: ['Ephemeral'] });
        conn.destroy();
        delete targetTextChannel[i.guildId];
        return i.reply({ content: '퇴장했습니다.', ephemeral: true });
    }

    /* ── 이동 ── */
    if (i.commandName === '이동') {
        const ch     = i.options.getChannel('채널');
        const target = i.options.getMember('대상');
        if (!ch) return i.reply({ content: '존재하지 않는 채널입니다.' });

        await i.deferReply({ flags: ['Ephemeral'] });

        if (!target || target.id === i.user.id) {
            const canJoin =
                ch.permissionsFor(i.member).has(PermissionsBitField.Flags.Connect) &&
                ch.permissionsFor(i.member).has(PermissionsBitField.Flags.ViewChannel);
            if (!canJoin) return i.editReply('이 채널은 당신이 접속할 수 없는 채널입니다.');

            i.member.voice.setChannel(ch)
                .then(() => i.editReply(`${ch.name} 채널로 이동했습니다`))
                .catch(err => {
                    i.editReply('오류가 발생했습니다! 나중에 다시 시도해주세요');
                    console.error(err + '');
                });
        } else {
            if (!i.member.permissions.has(PermissionsBitField.Flags.MoveMembers))
                return i.editReply('이 명령어를 사용할 권한이 없습니다. 본인을 선택하거나 권한을 부여받으십시오.');
            target.voice.setChannel(ch)
                .then(() => i.editReply(`${target.displayName}님을 ${ch.name} 채널로 이동했습니다`))
                .catch(err => {
                    i.editReply('오류가 발생했습니다! 나중에 다시 시도해주세요');
                    console.error(err + '');
                });
        }
    }

    /* ── 설정 ── */
    if (i.commandName === '설정') {
        const cfg   = await db.getUserConfig(i.guildId, i.user.id);
        const voice = i.options.getString('음성');
        const speed = i.options.getNumber('속도');
        const pitch = i.options.getNumber('피치');

        if (voice)        cfg.voice = voice;
        if (speed !== null) cfg.speed = speed;
        if (pitch !== null) cfg.pitch = pitch;

        await db.saveUserConfig(i.guildId, i.user.id, cfg);
        return i.reply({
            content: `설정 완료\n음성: ${cfg.voice}\n속도: ${cfg.speed}\n피치: ${cfg.pitch}`,
            ephemeral: true
        });
    }

    /* ── 설정공유 ── */
    if (i.commandName === '설정공유') {
        await i.deferReply({ flags: ['Ephemeral'] });

        if (i.options.getSubcommand() === '공유') {
            const userdata  = await db.getUserConfig(i.guild.id, i.user.id);
            const shareCode = crypto.randomBytes(5).toString('hex');
            await db.saveShareConfig(i.guild.id, shareCode, userdata);
            return i.editReply(`공유가 끝났습니다. 당신의 설정을 다른사람이 적용하려면 \`${shareCode}\`를 입력하세요.`);
        }

        if (i.options.getSubcommand() === '적용') {
            const code   = i.options.getString('공유코드');
            const shared = await db.getShareConfig(i.guild.id, code);
            if (!shared) return i.editReply('올바르지 않은 공유코드입니다.');
            await db.saveUserConfig(i.guild.id, i.user.id, shared);
            return i.editReply('적용이 끝났습니다.');
        }
    }

    /* ── 개발자 ── */
    if (i.commandName === '개발자') {
        if (i.user.id !== process.env.devId)
            return i.reply({ content: '개발자 전용 명령어입니다.', ephemeral: true });

        const group = i.options.getSubcommandGroup(false);
        const sub   = i.options.getSubcommand();

        /* 블랙리스트 관리 */
        if (group === '블랙리스트') {
            await i.deferReply({ flags: ['Ephemeral'] });

            if (sub === '추가') {
                const target = i.options.getUser('유저');
                const reason = i.options.getString('사유') ?? '사유 없음';
                await db.addBlacklist(target.id, reason, i.user.id);
                return i.editReply(`<@${target.id}> 를 블랙리스트에 추가했습니다.\n사유: ${reason}`);
            }

            if (sub === '제거') {
                const target  = i.options.getUser('유저');
                const removed = await db.removeBlacklist(target.id);
                return i.editReply(
                    removed
                        ? `<@${target.id}> 를 블랙리스트에서 제거했습니다.`
                        : `<@${target.id}> 는 블랙리스트에 없습니다.`
                );
            }

            if (sub === '목록') {
                const list = await db.listBlacklist();
                if (list.length === 0) return i.editReply('블랙리스트가 비어있습니다.');
                const lines = list.map(
                    r => `• <@${r.user_id}> — ${r.reason} (추가: <@${r.added_by}>, ${new Date(r.added_at).toLocaleString('ko-KR')})`
                ).join('\n');
                return i.editReply({ content: `**블랙리스트 목록 (${list.length}명)**\n${lines}`, allowedMentions: { users: [] } });
            }
        }

        /* 공지 / 들어가 */
        switch (sub) {
            case '공지': {
                await i.deferReply({ flags: ['Ephemeral'] });
                let count = 0;
                const target = i.options.getString('전송대상');
                const content = i.options.getString('내용');

                for (const g of i.client.guilds.cache.values()) {
                    try {
                        if (target === 'onlyserverowner') {
                            await (await g.members.fetch(g.ownerId)).send(content);
                        } else {
                            const c = getVoiceConnection(g.id);
                            if (!c) {
                                await (await g.members.fetch(g.ownerId)).send(content);
                            } else {
                                await (await g.channels.fetch(c.joinConfig.channelId)).send(content);
                            }
                        }
                        count++;
                    } catch (e) {
                        console.error(`공지 전송 실패 (${g.id}):`, e);
                    }
                }

                return i.editReply(`${count}개의 ${target === 'voicechannel' ? '음성채널에' : '서버주인에게'} 메세지를 전송했습니다`);
            }

            case '들어가': {
                const vc = i.options.getChannel('음성채널');
                const tc = i.options.getChannel('채팅채널');

                const conn = joinVoiceChannel({
                    channelId:      vc.id,
                    guildId:        vc.guild.id,
                    adapterCreator: vc.guild.voiceAdapterCreator
                });

                players[i.guildId] ??= createAudioPlayer();
                conn.subscribe(players[i.guildId]);
                targetTextChannel[i.guildId] = tc.id;
                await i.guild.members.me.voice?.setDeaf(true);

                return i.reply({
                    content: `음성 채널에 접속했습니다. vcid:${vc.id}, tcid:${tc.id}`,
                    ephemeral: true
                });
            }

            default:
                break;
        }
    }
});

/* ===================== Message TTS ===================== */

client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (targetTextChannel[msg.guildId] !== msg.channel.id) return;
    if (!getVoiceConnection(msg.guildId)) return;
    if (msg.content.startsWith('//')) return;
    if (msg.content.length > 200) return await msg.react('❌');

    if (await db.isBlacklisted(msg.author.id)) return;

    let text = replaceall(msg.content);

    if (msg.attachments.size > 0) {
        getQueue(msg.guildId, msg.channel.id).push({ text: '파일을 보냈어요', userId: msg.author.id });
    }
    getQueue(msg.guildId, msg.channel.id).push({ text, userId: msg.author.id });
    processQueue(msg.guildId, msg.channel.id);
});

/* ===================== 전원 퇴장시 자동 나가기 ===================== */

client.on(Events.VoiceStateUpdate, (oldState) => {
    const guildId = oldState.guild.id;
    const conn    = getVoiceConnection(guildId);
    if (!conn) return;

    const channel = oldState.guild.channels.cache.get(conn.joinConfig.channelId);
    if (!channel) return;

    if (channel.members.filter(m => !m.user.bot).size === 0) {
        conn.destroy();
        delete targetTextChannel[guildId];
        delete players[guildId];
        delete playing[guildId];
        if (queues[guildId]) delete queues[guildId];
        console.log(`[${guildId}] 모든 사용자가 퇴장하여 봇이 자동으로 나갔습니다.`);
    }
});

/* ===================== 에러 처리 ===================== */

client.on(Events.Error, async (error) => {
    console.error(`[ERROR] ${error.name}:`, error);
    try {
        const msg = await dev?.send(
            `에러발생\n에러이름: ${error.name}\n에러사유: ${error.cause}\n에러메세지: ${error.message}\n에러객체:\`\`\`json\n${JSON.stringify(error, null, 2)}\`\`\``
        );
        if (msg) console.error(`Check: ${msg.url}`);
    } catch (e) {
        console.error('dev DM 전송 실패:', e);
    }
});

process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled Rejection:', reason);
    try {
        await dev?.send(`[UnhandledRejection]\n\`\`\`\n${reason}\n\`\`\``);
    } catch { /* ignore */ }
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

/* ===================== Login ===================== */

client.login(process.env.DISCORD_TOKEN);
