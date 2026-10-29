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
    function make(tag) {
        const node = {
            tag,
            nodeType: 1,
            id: '',
            className: '',
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
            click() { this.dispatch('click'); },
        };
        node.classList = {
            add: (...names) => {
                node._classes.push(...names);
                node.className = node._classes.join(' ');
            },
            contains: (name) => node._classes.includes(name),
        };
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
