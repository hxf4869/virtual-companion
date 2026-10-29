// 酒馆抽屉原位成页。节点不搬动；仅在 body.vc-ui 且内容根带 openDrawer 时插入导航并播放推入。
import { icon } from './ui/icons.js';
import { animate } from './ui/motion.js';

export const DRAWER_PAGES = [
    { id: 'left-nav-panel', title: 'AI 回复配置' },
    { id: 'rm_api_block', title: 'API 连接' },
    { id: 'AdvancedFormatting', title: '提示词格式' },
    { id: 'WorldInfo', title: '世界书' },
    { id: 'user-settings-block', title: '界面' },
    { id: 'Backgrounds', title: '背景' },
    { id: 'rm_extensions_block', title: '扩展' },
    { id: 'PersonaManagement', title: '人设' },
    { id: 'right-nav-panel', title: '角色卡' },
];

const DRAWER_IDS = new Set(DRAWER_PAGES.map((page) => page.id));
const TITLE = Object.fromEntries(DRAWER_PAGES.map((page) => [page.id, page.title]));

let openModel = () => {};
let openAccount = () => {};
let observer = null;

export function vcUiEnabled(doc = globalThis.document) {
    try {
        return doc?.body?.classList?.contains?.('vc-ui') === true;
    } catch {
        return false;
    }
}

export function registerModelOpener(fn) {
    if (typeof fn === 'function') openModel = fn;
}

export function registerAccountOpener(fn) {
    if (typeof fn === 'function') openAccount = fn;
}

/** F1 设置项在扩展 init 完成之后调用。未注册时为空操作。 */
export function openModelSettings(opener) {
    return openModel(opener);
}

/** F1 设置项在扩展 init 完成之后调用。未注册时为空操作。 */
export function openAccountData(opener) {
    return openAccount(opener);
}

function byId(doc, id) {
    if (!doc || !DRAWER_IDS.has(id)) return null;
    if (typeof doc.getElementById === 'function') {
        const found = doc.getElementById(id);
        if (found) return found;
    }
    return doc.querySelector?.(`#${id}`) || null;
}

export function drawerToggleOf(root) {
    const parent = root?.parentElement || root?.parent;
    if (!parent) return null;
    const kids = parent.children ? [...parent.children] : [];
    const direct = kids.find((el) => hasClass(el, 'drawer-toggle'));
    if (direct) return direct;
    return parent.querySelector?.('.drawer-toggle') || null;
}

function hasClass(el, name) {
    if (!el) return false;
    if (typeof el.classList?.contains === 'function' && el.classList.contains(name)) return true;
    return String(el.className || '').split(/\s+/).includes(name);
}

function addClass(el, name) {
    if (!el || hasClass(el, name)) return;
    if (typeof el.classList?.add === 'function') el.classList.add(name);
    else el.className = `${el.className || ''} ${name}`.trim();
}

function removeClass(el, name) {
    if (!el || !hasClass(el, name)) return;
    if (typeof el.classList?.remove === 'function') {
        el.classList.remove(name);
        return;
    }
    el.className = String(el.className || '').split(/\s+/).filter((part) => part && part !== name).join(' ');
}

function removeNode(node) {
    if (!node) return;
    if (typeof node.remove === 'function') {
        node.remove();
        return;
    }
    const parent = node.parentElement;
    if (parent?.children && typeof parent.children.splice === 'function') {
        const index = parent.children.indexOf(node);
        if (index >= 0) parent.children.splice(index, 1);
    }
}

function prependNode(parent, node) {
    if (!parent || !node) return;
    if (typeof parent.prepend === 'function') {
        parent.prepend(node);
        return;
    }
    if (typeof parent.insertBefore === 'function' && parent.firstChild) {
        parent.insertBefore(node, parent.firstChild);
        return;
    }
    if (parent.children && typeof parent.children.unshift === 'function') {
        node.parentElement = parent;
        parent.children.unshift(node);
        if ('_html' in parent) parent._html = null;
        return;
    }
    parent.appendChild?.(node);
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function navMarkup(title) {
    return `<div class="vc-navbar" data-vc-drawer-nav style="--vc-nav-p:1"><button type="button" class="vc-btn vc-btn-text" data-vc-drawer-back aria-label="返回设置">${icon('chevron-left', { size: 22 })}<span>设置</span></button><div class="vc-nav-title">${esc(title)}</div><div class="vc-nav-spacer"></div></div>`;
}

function firstChild(node) {
    if (!node) return null;
    if (node.firstElementChild) return node.firstElementChild;
    return node.children?.[0] || null;
}

/**
 * 触发宿主 `.drawer-toggle`。已打开时不重复点击。
 * 调用时机：F1 设置列表点击酒馆项；返回按钮内部也会走到同一个开关。
 */
export function openDrawerPage(drawerId, doc = globalThis.document) {
    const root = byId(doc, drawerId);
    if (!root) return false;
    if (hasClass(root, 'openDrawer')) return true;
    const toggle = drawerToggleOf(root);
    if (!toggle) return false;
    if (typeof toggle.click === 'function') toggle.click();
    else toggle.dispatchEvent?.(new Event('click', { bubbles: true }));
    return true;
}

export function closeDrawerPage(root) {
    const toggle = drawerToggleOf(root);
    if (!toggle) return false;
    if (typeof toggle.click === 'function') toggle.click();
    else toggle.dispatchEvent?.(new Event('click', { bubbles: true }));
    syncDrawerPage(root, root?.ownerDocument || globalThis.document);
    return true;
}

function stripDrawerPage(root) {
    for (const item of root.getAnimations?.() || []) item.cancel();
    root.querySelectorAll?.('[data-vc-drawer-nav]').forEach?.(removeNode);
    removeClass(root, 'vc-drawer-page');
    removeClass(root, 'vc-drawer-leave');
}

function bindBack(root, nav) {
    const button = nav.querySelector?.('[data-vc-drawer-back]');
    button?.addEventListener?.('click', (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        closeDrawerPage(root);
    });
}

function presentDrawerPage(root) {
    removeClass(root, 'vc-drawer-leave');
    addClass(root, 'vc-drawer-page');
    if (root.querySelector?.('[data-vc-drawer-nav]')) return;
    const doc = root.ownerDocument || globalThis.document;
    const holder = doc.createElement('div');
    holder.innerHTML = navMarkup(TITLE[root.id] || '设置');
    const nav = firstChild(holder);
    if (!nav) return;
    if (holder.children && typeof holder.children.splice === 'function') holder.children.splice(0, 1);
    prependNode(root, nav);
    bindBack(root, nav);
    for (const item of root.getAnimations?.() || []) item.cancel();
    animate(root, [
        { transform: 'translateX(100%)' },
        { transform: 'none' },
    ], { duration: 560 });
}

function dismissDrawerPage(root) {
    if (!hasClass(root, 'vc-drawer-page') && !root.querySelector?.('[data-vc-drawer-nav]')) return;
    if (hasClass(root, 'vc-drawer-leave')) return;
    addClass(root, 'vc-drawer-leave');
    const done = () => stripDrawerPage(root);
    const leaving = animate(root, [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateX(100%)' },
    ], { duration: 480 });
    const timer = setTimeout(done, 700);
    leaving?.finished?.then(() => {
        clearTimeout(timer);
        done();
    }, () => {
        clearTimeout(timer);
        done();
    });
}

/** 根据当前 class 同步一页。测试与 MutationObserver 共用。 */
export function syncDrawerPage(root, doc = root?.ownerDocument || globalThis.document) {
    if (!root || !DRAWER_IDS.has(root.id)) return;
    if (!vcUiEnabled(doc)) {
        stripDrawerPage(root);
        return;
    }
    if (hasClass(root, 'openDrawer')) presentDrawerPage(root);
    else dismissDrawerPage(root);
}

export function mountDrawerPages(doc = globalThis.document) {
    if (!doc?.body) return observer;
    const marked = doc.body.getAttribute?.('data-vc-drawers') === '1' || doc.body.dataset?.vcDrawers === '1';
    if (marked) return observer;
    if (typeof doc.body.setAttribute === 'function') doc.body.setAttribute('data-vc-drawers', '1');
    else if (doc.body.dataset) doc.body.dataset.vcDrawers = '1';
    for (const page of DRAWER_PAGES) syncDrawerPage(byId(doc, page.id), doc);
    if (typeof MutationObserver === 'function' && doc.body) {
        observer = new MutationObserver((records) => {
            for (const record of records) {
                if (record.type !== 'attributes' || record.attributeName !== 'class') continue;
                if (record.target === doc.body) {
                    for (const page of DRAWER_PAGES) syncDrawerPage(byId(doc, page.id), doc);
                } else {
                    syncDrawerPage(record.target, doc);
                }
            }
        });
        observer.observe(doc.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
    return observer;
}
