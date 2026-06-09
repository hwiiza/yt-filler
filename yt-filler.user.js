// ==UserScript==
// @name         YouTube 概要欄フィラー (yt-filler)
// @namespace    hwiiza.yt-filler
// @version      1.7
// @description  指定フォーマットの .txt を読み込み、YouTube Studio のタイトル/概要欄/タグを自動入力する（チャンネル非依存の汎用ツール）
// @match        https://studio.youtube.com/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @homepageURL  https://github.com/hwiiza/yt-filler
// @downloadURL  https://raw.githubusercontent.com/hwiiza/yt-filler/main/yt-filler.user.js
// @updateURL    https://raw.githubusercontent.com/hwiiza/yt-filler/main/yt-filler.user.js
// ==/UserScript==
(function () {
  'use strict';

  const LS_KEY = 'crimson_yt_filler_payload';
  const THUMB_KEY = 'crimson_yt_filler_thumb';   // {name, durl} を保存（pick once→自動再利用）

  // GMストレージ薄ラッパ（無ければlocalStorage）
  const store = {
    get: (k) => (typeof GM_getValue === 'function') ? GM_getValue(k, '') : localStorage.getItem(k),
    set: (k, v) => (typeof GM_setValue === 'function') ? GM_setValue(k, v) : localStorage.setItem(k, v),
  };

  // ---------- パーサ（2形式対応） ----------
  // A) インライン見出し:  ==================== TITLE ====================
  // B) 罫線サンドイッチ:  ════ / TITLE（…） / ════  （見出しが別行・罫線は = か ═）
  function parse(text) {
    text = text.replace(/\r\n/g, '\n').replace(/^﻿/, '');
    const KEYS = ['TITLE', 'DESCRIPTION', 'TAGS', 'THUMBNAIL', 'VIDEO', 'NOTES', 'NOTE', 'CHANNEL'];
    const findKey = (s) => { const u = (s || '').trim().toUpperCase(); return KEYS.find(k => u.startsWith(k)) || null; };
    const buf = {};
    let cur = null, prevDivider = false;
    for (const line of text.split('\n')) {
      // 罫線のみの行（= か ═ が3つ以上・他は空白のみ）
      if (/^[\s=═]{3,}$/.test(line) && /[=═]/.test(line)) { prevDivider = true; continue; }
      // A) インライン見出し
      const inline = line.match(/^[=═]{2,}\s*(.+?)\s*[=═]{2,}\s*$/);
      if (inline) {
        const k = findKey(inline[1]);
        if (k) { cur = k; buf[k] = buf[k] || []; }
        prevDivider = false; continue;
      }
      // B) 罫線直後の既知ラベル行を見出しとみなす
      if (prevDivider) {
        prevDivider = false;
        const k = findKey(line);
        if (k) { cur = k; buf[k] = buf[k] || []; continue; }
        // 既知ラベルでなければ本文として扱う（下へ）
      }
      if (cur) buf[cur].push(line);
    }
    const get = (k) => (buf[k] ? buf[k].join('\n').replace(/^\n+|\n+$/g, '') : '');
    return {
      channel: get('CHANNEL'),
      title: get('TITLE').trim(),
      description: get('DESCRIPTION'),
      tags: get('TAGS').split(',').map(s => s.trim()).filter(Boolean),
      thumbnail: get('THUMBNAIL').trim(),
    };
  }

  // ---------- DOM ヘルパ ----------
  const isVisible = (e) => !!(e && e.getClientRects().length && e.offsetParent !== null);
  // 複数セレクタ候補から「可視」な要素を優先して返す（無ければ最初に見つかった物）
  const q = (sels) => {
    let first = null;
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        if (!first) first = el;
        if (isVisible(el)) return el;
      }
    }
    return first;
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 要素生成ヘルパ（innerHTML不使用＝Trusted Types環境でも安全）
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'style') e.style.cssText = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (kids) for (const c of kids) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }

  // React/Polymer の <input>/<textarea> に確実に値を入れる（native setter + input/change）
  function setNativeValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getTitleBox() {
    return q(['#title-textarea #textbox', 'ytcp-social-suggestions-textbox[id="title-textarea"] #textbox', '#title #textbox']);
  }
  function getDescBox() {
    return q(['#description-textarea #textbox', 'ytcp-social-suggestions-textbox[id="description-textarea"] #textbox', '#description #textbox']);
  }
  function getTagsInput() {
    return q(['#tags-container #text-input', '#tags input#text-input', 'ytcp-form-input-container[id*="tags"] input', '#text-input.ytcp-chip-bar', 'input[aria-label*="tag" i]']);
  }

  // contenteditable に確実に入れる（Polymer の input イベントを発火）
  function setEditable(el, text) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function commitTag(input, tag) {
    input.focus();
    setNativeValue(input, '');      // 既存入力中の文字をクリア
    setNativeValue(input, tag);     // native setter で値を反映
    await sleep(60);
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    }
    await sleep(120);
  }

  // ---------- アクション ----------
  function setTitle(data, log) {
    const el = getTitleBox();
    if (!el) { log('✖ タイトル欄が見つかりません（アップロード/詳細編集画面を開いて）', true); return false; }
    setEditable(el, data.title);
    log('✔ タイトル設定: ' + data.title);
    return true;
  }
  function setDesc(data, log) {
    const el = getDescBox();
    if (!el) { log('✖ 概要欄が見つかりません（アップロード/詳細編集画面を開いて）', true); return false; }
    setEditable(el, data.description);
    log('✔ 概要欄設定: ' + data.description.length + '文字');
    return true;
  }
  async function setTags(data, log) {
    const input = getTagsInput();
    if (!input) { log('✖ タグ入力欄が見つかりません（「すべて表示」を押してタグ欄を表示して）', true); return false; }
    for (const t of data.tags) { await commitTag(input, t); }
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    log('✔ タグ設定: ' + data.tags.length + '個（反映を目視確認してください）');
    return true;
  }

  // YouTube側のサムネ用 file input を探す（自分のパネル内の入力は除外）
  function getThumbInput() {
    const sels = ['ytcp-thumbnails-compact-editor input[type="file"]', 'input#file-loader[type="file"]', 'input[type="file"][accept*="image"]', 'input[type="file"]'];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        if (el.closest('#crimson-yt-panel')) continue;
        return el;
      }
    }
    return null;
  }
  // 画像File を YouTube のサムネ入力へ流し込む
  function applyThumbFile(file, log) {
    const input = getThumbInput();
    if (!input) { log('✖ サムネのファイル入力が見つかりません（詳細画面でサムネ欄を表示）', true); return false; }
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      log('✔ サムネ設定: ' + file.name + '（プレビュー反映を確認）');
      return true;
    } catch (e) { log('✖ サムネ設定失敗: ' + e.message, true); return false; }
  }
  // dataURL → File（GMストレージ保存→復元用）
  function dataURLtoFile(durl, name) {
    const i = durl.indexOf(',');
    const meta = durl.slice(0, i), b64 = durl.slice(i + 1);
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    return new File([arr], name || 'thumbnail.jpg', { type: mime });
  }
  // basename 抽出（パス表示用）
  function baseName(p) { return (p || '').trim().replace(/\\/g, '/').split('/').pop() || ''; }

  // 優先: 手動で選んだ/復元したFile → 無ければ案内（Chrome MV3ではパス自動読込不可）
  function setThumbnail(thumbFile, data, log) {
    if (thumbFile) return applyThumbFile(thumbFile, log);
    const hint = (data && data.thumbnail) ? '「' + baseName(data.thumbnail) + '」を ②サムネ画像 で選択してください' : '②サムネ画像 で画像を選択してください';
    log('✖ サムネ画像が未読込。' + hint + '（一度選べば次回以降は自動再利用）', true);
    return false;
  }
  // 対象視聴者「いいえ、子ども向けではありません」を選択
  function setNotForKids(log) {
    let el = document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
    if (!el) {
      const cands = [...document.querySelectorAll('tp-yt-paper-radio-button, ytcp-radio-button, [role="radio"]')];
      el = cands.find(c => /子ども向けではありません|子供向けではありません/.test(c.textContent || ''))
        || cands.find(c => /not made for kids|not .* for kids/i.test(c.textContent || ''));
    }
    if (!el) { log('✖ 「子ども向けではありません」が見つかりません（対象視聴者セクションを表示）', true); return false; }
    el.click();
    log('✔ 視聴者: いいえ、子ども向けではありません');
    return true;
  }

  // ---------- UI ----------
  function buildPanel() {
    if (document.getElementById('crimson-yt-panel')) return;
    const box = document.createElement('div');
    box.id = 'crimson-yt-panel';
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;background:#111;color:#eee;border:1px solid #e11;border-radius:10px;font:12px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);overflow:hidden';

    const head = el('div', { id: 'cyt-head', style: 'background:#c00;padding:8px 10px;font-weight:700;cursor:move;display:flex;justify-content:space-between;align-items:center' }, [
      el('span', { text: '🔴 yt-filler' }),
      el('span', { id: 'cyt-min', text: '_', style: 'cursor:pointer' }),
    ]);
    const fileInput = el('input', { id: 'cyt-file', type: 'file', accept: '.txt', style: 'display:block;margin-top:3px;width:100%;font-size:11px' });
    const label = el('label', { style: 'display:block' }, ['① txtを読込', fileInput]);
    const thumbInput = el('input', { id: 'cyt-thumb', type: 'file', accept: 'image/*', style: 'display:block;margin-top:3px;width:100%;font-size:11px' });
    const thumbLabel = el('label', { style: 'display:block' }, ['② サムネ画像(任意)', thumbInput]);
    const infoDiv = el('div', { id: 'cyt-info', text: '未読込', style: 'font-size:11px;color:#aaa;white-space:pre-wrap;min-height:34px;background:#000;padding:5px;border-radius:5px' });
    const mkBtn = (act, txt, extra) => el('button', Object.assign({ 'data-act': act, class: 'cyt-b', text: txt }, extra ? { style: extra } : {}));
    const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:5px' }, [
      mkBtn('title', 'タイトル'), mkBtn('desc', '概要欄'), mkBtn('tags', 'タグ'),
      mkBtn('thumb', 'サムネ'), mkBtn('kids', '子供向けでない'),
      mkBtn('all', '全部設定', 'background:#c00;border-color:#c00'),
    ]);
    const logDiv = el('div', { id: 'cyt-log', style: 'font-size:11px;max-height:120px;overflow:auto;background:#000;padding:5px;border-radius:5px' });
    const bodyDiv = el('div', { id: 'cyt-body', style: 'padding:10px;display:flex;flex-direction:column;gap:7px' }, [label, thumbLabel, infoDiv, grid, logDiv]);
    box.appendChild(head);
    box.appendChild(bodyDiv);
    document.body.appendChild(box);

    if (!document.getElementById('crimson-yt-style')) {
      const style = document.createElement('style');
      style.id = 'crimson-yt-style';
      // ホストCSSとの衝突回避のため #crimson-yt-panel 配下にスコープ
      style.textContent = '#crimson-yt-panel *{box-sizing:border-box}#crimson-yt-panel .cyt-b{background:#222;color:#eee;border:1px solid #555;border-radius:6px;padding:6px;cursor:pointer;font-size:12px}#crimson-yt-panel .cyt-b:hover{background:#333}';
      document.head.appendChild(style);
    }

    const info = box.querySelector('#cyt-info');
    const logEl = box.querySelector('#cyt-log');
    const log = (msg, err) => {
      const d = document.createElement('div');
      d.textContent = msg;
      if (err) d.style.color = '#f66';
      logEl.prepend(d);
    };

    let data = null;
    let thumbFile = null;
    const showInfo = () => {
      const lines = [];
      if (data) {
        lines.push(`Title: ${data.title}`);
        lines.push(`Desc: ${data.description.length}字 / Tags: ${data.tags.length}個`);
      }
      if (thumbFile) lines.push('Thumb: ' + thumbFile.name + '（保存済・自動再利用）');
      else if (data && data.thumbnail) lines.push('Thumb: ' + baseName(data.thumbnail) + '（②で選択して下さい）');
      info.textContent = lines.length ? lines.join('\n') : '未読込';
    };

    // txt を復元
    try {
      const saved = store.get(LS_KEY);
      if (saved) { data = JSON.parse(saved); log('（前回の読込内容を復元）'); }
    } catch (e) {}
    // サムネ画像を復元（pick once → 自動再利用）
    try {
      const t = store.get(THUMB_KEY);
      if (t) { const o = JSON.parse(t); thumbFile = dataURLtoFile(o.durl, o.name); log('（保存済サムネを復元: ' + o.name + '）'); }
    } catch (e) {}
    showInfo();

    box.querySelector('#cyt-file').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          data = parse(r.result);
          store.set(LS_KEY, JSON.stringify(data));
          showInfo();
          log('✔ 読込OK: ' + f.name);
        } catch (e) { log('✖ パース失敗: ' + e.message, true); }
      };
      r.readAsText(f, 'UTF-8');
    });

    box.querySelector('#cyt-thumb').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      thumbFile = f;
      const r = new FileReader();
      r.onload = () => {
        try { store.set(THUMB_KEY, JSON.stringify({ name: f.name, durl: r.result })); } catch (e) { log('（サムネ保存失敗: ' + e.message + '）', true); }
        showInfo();
        log('✔ サムネ画像: ' + f.name + '（保存→次回自動再利用）');
      };
      r.readAsDataURL(f);
    });

    box.querySelectorAll('.cyt-b').forEach(b => b.addEventListener('click', async () => {
      const act = b.dataset.act;
      // txtが要るアクションのみ事前チェック
      if ((act === 'title' || act === 'desc' || act === 'tags' || act === 'all') && !data) {
        log('先に txt を読み込んでください', true); return;
      }
      if (act === 'title') setTitle(data, log);
      else if (act === 'desc') setDesc(data, log);
      else if (act === 'tags') await setTags(data, log);
      else if (act === 'thumb') setThumbnail(thumbFile, data, log);
      else if (act === 'kids') setNotForKids(log);
      else if (act === 'all') {
        setTitle(data, log);
        await sleep(300);
        setDesc(data, log);
        await sleep(300);
        await setTags(data, log);
        await sleep(300);
        setNotForKids(log);
        if (thumbFile || (data && data.thumbnail)) { await sleep(300); setThumbnail(thumbFile, data, log); }
      }
    }));

    // 最小化
    box.querySelector('#cyt-min').addEventListener('click', () => {
      const body = box.querySelector('#cyt-body');
      body.style.display = body.style.display === 'none' ? 'flex' : 'none';
    });

    // ドラッグ移動
    (function drag() {
      const head = box.querySelector('#cyt-head');
      let sx, sy, ox, oy, on = false;
      head.addEventListener('mousedown', e => { if (e.target.id === 'cyt-min') return; on = true; sx = e.clientX; sy = e.clientY; const r = box.getBoundingClientRect(); ox = r.left; oy = r.top; e.preventDefault(); });
      document.addEventListener('mousemove', e => { if (!on) return; box.style.left = (ox + e.clientX - sx) + 'px'; box.style.top = (oy + e.clientY - sy) + 'px'; box.style.right = 'auto'; box.style.bottom = 'auto'; });
      document.addEventListener('mouseup', () => on = false);
    })();
  }

  // SPA対策: 冪等な init を一定間隔で呼び、UIが消えたら再注入（§2）
  const init = () => {
    if (!document.body) return;
    if (document.getElementById('crimson-yt-panel')) return;
    buildPanel();
  };
  init();
  setInterval(init, 1500);
})();
