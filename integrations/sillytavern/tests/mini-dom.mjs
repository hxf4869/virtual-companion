// 离线单测用的最小 DOM。只覆盖本目录页面测试实际调用的节点操作。

export function installMiniDom() {
    const nodes = [];
    function textOf(node) {
        if (!node) return '';
        if (node.nodeType === 3) return node.textContent;
        if (node._text != null && node.children.length === 0) return node._text;
        return node.children.map(textOf).join('');
    }
    function htmlOf(node) {
        if (!node || node.nodeType === 3) return node?.textContent ?? '';
        const attrs = Object.entries(node.attributes).map(([key, value]) => ` ${key}="${value}"`).join('');
        const inner = node._html != null
            ? node._html
            : (node.children.length ? node.children.map(htmlOf).join('') : (node._text ?? ''));
        return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
    }
    function matches(node, sel) {
        if (!node || node.nodeType === 3) return false;
        if (sel.startsWith('#')) return node.id === sel.slice(1);
        if (sel.startsWith('.')) return node.className.split(/\s+/).includes(sel.slice(1));
        const attr = /^\[([^\]=]+)="([^"]*)"\]$/.exec(sel);
        if (attr) return node.attributes[attr[1]] === attr[2];
        const presence = /^\[([^\]=\s]+)\]$/.exec(sel);
        if (presence) return Object.hasOwn(node.attributes, presence[1]);
        return node.tag === sel;
    }
    function query(node, sel) {
        if (!node?.children) return null;
        for (const child of node.children) {
            if (matches(child, sel)) return child;
            const found = query(child, sel);
            if (found) return found;
        }
        return null;
    }
    function queryAll(node, sel, out = []) {
        if (!node?.children) return out;
        for (const child of node.children) {
            if (matches(child, sel)) out.push(child);
            queryAll(child, sel, out);
        }
        return out;
    }
    const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    function applyAttrs(node, raw) {
        const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        let match;
        while ((match = re.exec(raw))) {
            const key = match[1];
            if (key === '/') continue;
            const value = match[2] ?? match[3] ?? match[4] ?? '';
            node.setAttribute(key, value);
            if (key === 'class') {
                node._classes = value.split(/\s+/).filter(Boolean);
                node.className = node._classes.join(' ');
            }
            if (key === 'type') node.type = value;
            if (key === 'name') node.name = value;
        }
    }
    function parseHTML(html, parent) {
        const stack = [parent];
        const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g;
        let match;
        while ((match = re.exec(html))) {
            if (match[0].startsWith('<!--')) continue;
            if (match[1]) {
                const tag = match[1].toLowerCase();
                while (stack.length > 1 && stack.at(-1).tag !== tag) stack.pop();
                if (stack.length > 1) stack.pop();
                continue;
            }
            if (match[2]) {
                const tag = match[2].toLowerCase();
                const node = make(tag);
                applyAttrs(node, match[3] || '');
                const host = stack.at(-1);
                node.parent = host;
                host.children.push(node);
                if (match[4] !== '/' && !voidTags.has(tag)) stack.push(node);
                continue;
            }
            if (match[5]) {
                const host = stack.at(-1);
                host.children.push({ nodeType: 3, textContent: match[5], children: [], parent: host });
            }
        }
    }
    function make(tag) {
        const node = {
            tag,
            nodeType: 1,
            id: '',
            _classes: [],
            _text: null,
            _html: null,
            children: [],
            attributes: {},
            listeners: {},
            parent: null,
            value: '',
            open: false,
            style: { setProperty(key, value) { this[key] = value; } },
            classList: null,
            dataset: null,
            setAttribute(key, value) {
                this.attributes[key] = String(value);
                if (key === 'id') this.id = String(value);
                if (key === 'hidden') this.hidden = true;
            },
            removeAttribute(key) {
                delete this.attributes[key];
                if (key === 'id') this.id = '';
                if (key === 'hidden') this.hidden = false;
            },
            getAttribute(key) { return this.attributes[key]; },
            append(...items) {
                for (const item of items) {
                    if (item == null) continue;
                    item.parent = this;
                    this.children.push(item);
                }
                this._text = null;
                this._html = null;
            },
            remove() {
                const list = this.parent?.children;
                if (!list) return;
                const index = list.indexOf(this);
                if (index >= 0) list.splice(index, 1);
                this.parent = null;
            },
            replaceChildren(...items) {
                this.children = [];
                this._html = null;
                this._text = null;
                if (items.length) this.append(...items);
            },
            addEventListener(type, fn) {
                (this.listeners[type] ||= []).push(fn);
            },
            dispatch(type, extra = {}) {
                const event = {
                    type,
                    target: this,
                    preventDefault() { event.defaultPrevented = true; },
                    defaultPrevented: false,
                    ...extra,
                };
                for (const fn of this.listeners[type] || []) fn(event);
                return event;
            },
            querySelector(sel) { return query(this, sel); },
            querySelectorAll(sel) { return queryAll(this, sel); },
            focus() { document.activeElement = this; },
            showModal() { this.open = true; },
            close() { this.open = false; },
            reset() {},
            click() { this.dispatch('click'); },
        };
        node.classList = {
            add: (...names) => {
                for (const name of names) {
                    if (!name || node._classes.includes(name)) continue;
                    node._classes.push(name);
                }
            },
            remove: (...names) => {
                node._classes = node._classes.filter((item) => !names.includes(item));
            },
            toggle: (name, force) => {
                const has = node._classes.includes(name);
                const next = force === undefined ? !has : Boolean(force);
                if (next && !has) node._classes.push(name);
                if (!next && has) node._classes = node._classes.filter((item) => item !== name);
                return next;
            },
            contains: (name) => node._classes.includes(name),
        };
        Object.defineProperty(node, 'className', {
            get() { return node._classes.join(' '); },
            set(value) {
                node._classes = String(value ?? '').split(/\s+/).filter(Boolean);
            },
        });
        Object.defineProperty(node, 'textContent', {
            get() { return textOf(node); },
            set(value) {
                node._text = String(value);
                node.children = [];
                node._html = null;
            },
        });
        Object.defineProperty(node, 'innerHTML', {
            get() { return node._html != null ? node._html : node.children.map(htmlOf).join(''); },
            set(value) {
                node._html = String(value);
                node.children = [];
                node._text = null;
                parseHTML(node._html, node);
            },
        });
        Object.defineProperty(node, 'dataset', {
            get() {
                const out = {};
                for (const [key, value] of Object.entries(node.attributes)) {
                    if (key.startsWith('data-')) out[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
                }
                return out;
            },
        });
        nodes.push(node);
        return node;
    }
    const document = {
        cookie: '',
        activeElement: null,
        body: null,
        head: null,
        documentElement: null,
        createElement: make,
        createTextNode(text) { return { nodeType: 3, textContent: String(text), children: [] }; },
        querySelector(sel) { return query(document.documentElement, sel); },
        querySelectorAll(sel) { return queryAll(document.documentElement, sel); },
    };
    document.documentElement = make('html');
    document.head = make('head');
    document.body = make('body');
    document.documentElement.append(document.head, document.body);
    document.activeElement = document.body;
    globalThis.document = document;
    return document;
}

export function buttonByText(document, text) {
    return document.querySelectorAll('button').find((button) => button.textContent.includes(text));
}
