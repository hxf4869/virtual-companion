// 验收用合成 fixture 构造器：全部原创合成内容，不含真实数据。
// 提供最小 PNG 编码（含 tEXt chara 块的 V2 卡）、仅存储模式 ZIP（CHARX）、CCv2/CCv3 卡与世界书构造。
import zlib from 'node:zlib';

// ---------- PNG ----------
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
}

/** 纯色 RGBA PNG；textChunks: {keyword: latin1String} 以 tEXt 写入（ST 卡用 chara=base64(JSON)）。 */
export function makePng({ width = 64, height = 64, rgba = [120, 160, 200, 255], textChunks = {} } = {}) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) { row[1 + x * 4] = rgba[0]; row[2 + x * 4] = rgba[1]; row[3 + x * 4] = rgba[2]; row[4 + x * 4] = rgba[3]; }
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
    for (const [k, v] of Object.entries(textChunks)) parts.push(chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'latin1')])));
    parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
    return Buffer.concat(parts);
}

export function pngSize(buf) {
    if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 读取 PNG 中 tEXt chara 块并解码 JSON（校验导入/导出用）。 */
export function readCharaChunk(buf) {
    let off = 8;
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off); const type = buf.toString('latin1', off + 4, off + 8);
        if (type === 'tEXt') {
            const data = buf.subarray(off + 8, off + 8 + len);
            const nul = data.indexOf(0);
            if (data.subarray(0, nul).toString('latin1') === 'chara') return JSON.parse(Buffer.from(data.subarray(nul + 1).toString('latin1'), 'base64').toString('utf8'));
        }
        off += 12 + len;
    }
    return null;
}

export function makePngCard(card, opts = {}) {
    return makePng({ ...opts, textChunks: { chara: Buffer.from(JSON.stringify(card), 'utf8').toString('base64') } });
}

// ---------- ZIP (stored) ----------
export function makeStoredZip(entries) {
    const locals = []; const centrals = []; let offset = 0;
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = zlib.crc32(data) >>> 0;
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
        lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
        ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
        locals.push(lh, nameBuf, data); centrals.push(ch, nameBuf);
        offset += lh.length + nameBuf.length + data.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, cd, eocd]);
}

// ---------- cards ----------
export function bookEntry({ id, keys = [], secondary_keys = [], content, constant = false, selective = false, insertion_order = 100, comment = '', extensions = {} }) {
    return { id, keys, secondary_keys, content, constant, selective, enabled: true, insertion_order, case_sensitive: false, name: comment, comment, priority: insertion_order, position: 'before_char', extensions };
}

export function cardV2({ name, description, first_mes, personality = '原创合成人格', scenario = '原创合成场景', mes_example = '', alternate_greetings = [], book = null, extensions = {}, creator_notes = '' }) {
    const data = {
        name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt: '', post_history_instructions: '',
        alternate_greetings, tags: ['vc-acceptance', 'synthetic'], creator: 'vc-w03-s1', character_version: '1.0',
        extensions: { vc_fixture: { synthetic: true, case: 'acceptance' }, ...extensions },
    };
    if (book) data.character_book = book;
    return { spec: 'chara_card_v2', spec_version: '2.0', name, description, personality, scenario, first_mes, mes_example, data };
}

export function cardV3(v2, assets) {
    const d = { ...v2.data, assets, group_only_greetings: [], creation_date: 0, modification_date: 0 };
    return { spec: 'chara_card_v3', spec_version: '3.0', data: d };
}

export function worldBook(name, entries, { scan_depth = 4, token_budget = 400, recursive_scanning = false } = {}) {
    return { name, description: '原创合成验收世界书', scan_depth, token_budget, recursive_scanning, extensions: {}, entries };
}
