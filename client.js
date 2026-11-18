/**
 * Option brief — a right-sidebar tab that shows every option of a pending
 * question together with its description and sample files.
 *
 * Where the data comes from (no Host half needed):
 * - `uiSession.sessionStatus` is the Client's unified pending-interaction
 *   source. It carries the question card, the plan-review card, and the
 *   approval card, so one subscription covers every "you must decide" surface.
 *   (The `userQuestions` session projection is not usable here: it only folds
 *   `ask_user_question` calls made under the timed schema.)
 * - `sidebarRightTabs.register` + `sidebarRight.openTab` put our page tab in the
 *   shipped right sidebar, and the pending interaction drives open/close.
 * - Sample files are read through `remote.workspaceFiles` (images inline, HTML in
 *   a sandboxed frame, text inline) and can be opened in the shipped document
 *   preview with `sidebarRight.openResource`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-options',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'optionBrief';
    const KIND = 'option-brief';
    const TYPE_ID = 'dsh-sidebar-options';
    const MAX_FILES_PER_OPTION = 8;
    /** How many files the panel lifts out of the message body's `present` cards. */
    const MAX_PRESENTED_FILES = 6;
    const MAX_TEXT_PREVIEW_LINES = 32;
    const TEXT_READ_LIMIT = 4000;
    const HTML_READ_LIMIT = 4000;
    /** Design width an HTML sample is laid out at before it is scaled into the panel. */
    const HTML_DESIGN_WIDTH = 960;
    /** Design height of that layout, which sets the scaled preview's height. */
    const HTML_DESIGN_HEIGHT = 620;

    // ---------------------------------------------------------------------
    // Shared module state: the watcher writes, the tab body reads.
    // ---------------------------------------------------------------------

    /** @type {{ status: 'idle'|'waiting'|'ready', brief: object|null }} */
    let snapshot = { status: 'idle', brief: null };
    const listeners = new Set();

    function publish(next) {
      snapshot = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.error('[option-brief] listener failed', error);
        }
      }
    }

    function useSnapshot() {
      const [value, setValue] = React.useState(snapshot);
      React.useEffect(() => {
        const listener = () => setValue(snapshot);
        listeners.add(listener);
        setValue(snapshot);
        return () => {
          listeners.delete(listener);
        };
      }, []);
      return value;
    }

    // ---------------------------------------------------------------------
    // Path discovery: option descriptions carry absolute or relative paths.
    // ---------------------------------------------------------------------

    const EXT = 'html?|htm|png|jpe?g|webp|gif|svg|md|markdown|txt|pdf|pptx?|docx?|xlsx?|csv|json|mp4|mov|mp3|wav';

    const ABS_RE = new RegExp('(?<![\\w])[A-Za-z]:[\\\\/][^<>"|?*\\r\\n]+?\\.(?:' + EXT + ')', 'gi');
    const MD_LINK_RE = new RegExp('\\]\\(([^)\\s]+?\\.(?:' + EXT + '))\\)', 'gi');
    const FILE_URL_RE = new RegExp('file://[^\\s"\'<>]+?\\.(?:' + EXT + ')', 'gi');
    const REL_RE = new RegExp(
      '(?:^|[^\\w\\-.@\\\\/])((?:\\.{1,2}[\\\\/])?(?:[\\w\\-.@\\u3000-\\u9fff]+[\\\\/])+[\\w\\-.@\\u3000-\\u9fff\\s]{0,60}?\\.(?:' + EXT + '))',
      'g',
    );

    const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
    const HTML_EXT = new Set(['html', 'htm']);
    const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'json', 'csv']);

    const MIME = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      svg: 'image/svg+xml',
    };

    function extensionOf(path) {
      const match = /\.([A-Za-z0-9]+)$/.exec(path);
      return match === null ? '' : match[1].toLowerCase();
    }

    function kindOf(path) {
      const ext = extensionOf(path);
      if (IMAGE_EXT.has(ext)) return 'image';
      if (HTML_EXT.has(ext)) return 'html';
      if (TEXT_EXT.has(ext)) return 'text';
      return 'file';
    }

    function tidyPath(raw) {
      let value = String(raw).trim();
      value = value.replace(/^[`"'(（【\[]+/, '');
      value = value.replace(/[`"'>)）】\]，,。;；]+$/, '');
      if (/^file:\/\//i.test(value)) {
        value = value.replace(/^file:\/\/\/?/i, '');
        try {
          value = decodeURIComponent(value);
        } catch (_error) {
          // keep the raw spelling
        }
      }
      if (/^\/[A-Za-z]:[\\/]/.test(value)) value = value.slice(1);
      return value.trim();
    }

    /** Collect distinct sample-file paths mentioned in free text. */
    function extractPaths(text) {
      if (typeof text !== 'string' || text === '') return [];
      const found = [];
      const seen = new Set();
      const take = (raw) => {
        const path = tidyPath(raw);
        if (path === '' || path.length > 400) return;
        const key = path.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        found.push({ path, ext: extensionOf(path), kind: kindOf(path) });
      };
      for (const match of text.matchAll(MD_LINK_RE)) take(match[1]);
      for (const match of text.matchAll(FILE_URL_RE)) take(match[0]);
      for (const match of text.matchAll(ABS_RE)) take(match[0]);
      for (const match of text.matchAll(REL_RE)) take(match[1]);
      return found.slice(0, MAX_FILES_PER_OPTION);
    }

    /** The same patterns as a plain membership test, for text that mentions a file. */
    const PATH_HINTS = [ABS_RE, MD_LINK_RE, FILE_URL_RE, REL_RE].map((re) => new RegExp(re.source, re.flags.replace('g', '')));

    function mentionsPath(segment) {
      return PATH_HINTS.some((re) => re.test(segment));
    }

    /**
     * Option descriptions carry sample paths on purpose — that is the protocol — but
     * the panel lists those files as their own titles, so the rendered sentence keeps
     * the wording and drops the addresses instead of repeating them.
     */
    function cleanDescription(text) {
      if (typeof text !== 'string' || text === '') return '';
      const segments = text.split(/(?<=[。；;!！?\n])/);
      const kept = segments.filter((segment) => segment.trim() !== '' && !mentionsPath(segment));
      return kept.join('').replace(/[ \t]{2,}/g, ' ').trim();
    }

    // ---------------------------------------------------------------------
    // Remote helpers
    // ---------------------------------------------------------------------

    function unwrap(result) {
      if (result !== null && typeof result === 'object' && 'ok' in result) {
        if (!result.ok) {
          const message = result.error && result.error.message ? result.error.message : 'the Host refused the read';
          throw new Error(message);
        }
        return result.value;
      }
      return result;
    }

    function bytesOf(data) {
      if (data instanceof Uint8Array) return data;
      if (Array.isArray(data)) return Uint8Array.from(data);
      if (data !== null && typeof data === 'object') {
        if (data.type === 'Buffer' && Array.isArray(data.data)) return Uint8Array.from(data.data);
        const nested = data.data;
        if (nested instanceof Uint8Array) return nested;
        if (Array.isArray(nested)) return Uint8Array.from(nested);
      }
      return undefined;
    }

    function toBase64(bytes) {
      let binary = '';
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
      }
      return btoa(binary);
    }

    /** Encode a path the way `dsh-resource://file/session/<id>/<path>` expects. */
    function fileAddress(sessionId, path) {
      const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
      const encoded = normalized
        .split('/')
        .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
        .join('/');
      return 'dsh-resource://file/session/' + encodeURIComponent(sessionId) + '/' + encoded;
    }

    // ---------------------------------------------------------------------
    // View
    // ---------------------------------------------------------------------

    const CSS = `
.ob-root { box-sizing: border-box; height: 100%; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 14px; padding: 14px 14px 28px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; }
.ob-head { display: flex; flex-direction: column; gap: 4px; }
.ob-kicker { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.ob-title { font-size: 14px; font-weight: 600; }
.ob-question { color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }
.ob-detail { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; font-size: 12px; color: var(--dsw-alias-label-secondary); max-height: 300px; overflow: auto; }
.ob-options { display: flex; flex-direction: column; gap: 10px; }
.ob-option { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-1); }
.ob-option-head { display: flex; align-items: baseline; gap: 6px; }
.ob-badge { flex: none; font-size: 11px; font-weight: 600; color: var(--dsw-alias-brand-primary); border: 1px solid currentColor; border-radius: 6px; padding: 0 5px; line-height: 16px; }
.ob-label { font-weight: 600; font-size: 13px; word-break: break-word; }
.ob-desc { color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.ob-files { display: flex; flex-direction: column; gap: 8px; }
.ob-files-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.ob-file { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-base); }
.ob-file-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.ob-file-head:hover { background: var(--dsw-alias-bg-layer-2); }
.ob-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--dsw-alias-label-primary); }
.ob-file-body { padding: 0 8px 8px; }
.ob-file-body img { display: block; width: 100%; max-height: 200px; object-fit: contain; border-radius: 6px; background: #fff; cursor: pointer; outline: 1px solid var(--dsw-alias-border-l1); outline-offset: -1px; }
.ob-frame { position: relative; overflow: hidden; border-radius: 6px; background: #fff; outline: 1px solid var(--dsw-alias-border-l1); outline-offset: -1px; }
.ob-frame iframe { display: block; border: 0; }
.ob-file-body pre { margin: 0; max-height: 200px; overflow: auto; font-size: 11px; line-height: 1.45; white-space: pre; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); border-radius: 6px; padding: 8px; }
.ob-note { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.ob-empty { display: flex; flex-direction: column; gap: 6px; }
.ob-empty strong { color: var(--dsw-alias-label-primary); font-size: 13px; }
.ob-empty span { color: var(--dsw-alias-label-secondary); }
`;

    function Note({ children }) {
      return h('div', { className: 'ob-note' }, children);
    }

    function ScaledFrame({ title, html }) {
      const boxRef = React.useRef(null);
      const [scale, setScale] = React.useState(0);

      React.useEffect(() => {
        const box = boxRef.current;
        if (!box) return undefined;
        const measure = () => {
          const width = box.clientWidth;
          if (width > 0) setScale(Math.min(1, width / HTML_DESIGN_WIDTH));
        };
        measure();
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure);
          observer.observe(box);
          return () => observer.disconnect();
        }
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, []);

      const effective = scale > 0 ? scale : 0.5;
      return h(
        'div',
        { ref: boxRef, className: 'ob-frame', style: { height: Math.round(HTML_DESIGN_HEIGHT * effective) } },
        h('iframe', {
          title,
          srcDoc: html,
          sandbox: '',
          loading: 'lazy',
          style: {
            width: HTML_DESIGN_WIDTH + 'px',
            height: HTML_DESIGN_HEIGHT + 'px',
            transform: 'scale(' + effective + ')',
            transformOrigin: 'top left',
          },
        }),
      );
    }

    function FileBody({ file, sessionId, t }) {
      const [state, setState] = React.useState({ status: 'loading' });

      React.useEffect(() => {
        let alive = true;
        const controller = new AbortController();
        const fail = (error) => {
          if (!alive) return;
          setState({ status: 'error', message: error && error.message ? error.message : String(error) });
        };
        (async () => {
          try {
            const remote = typeof ctxRef.get === 'function' ? ctxRef.get('remote.workspaceFiles') : undefined;
            if (!remote) throw new Error(t('file.missing'));
            if (file.kind === 'image') {
              const value = unwrap(await remote.readBytes(sessionId, file.path, {}, controller.signal));
              const bytes = bytesOf(value && value.data !== undefined ? value.data : value);
              if (!bytes || bytes.length === 0) throw new Error(t('file.missing'));
              if (!alive) return;
              setState({
                status: 'image',
                url: 'data:' + (MIME[file.ext] || 'application/octet-stream') + ';base64,' + toBase64(bytes),
              });
              return;
            }
            if (file.kind === 'html' || file.kind === 'text') {
              const limit = file.kind === 'html' ? HTML_READ_LIMIT : TEXT_READ_LIMIT;
              const value = unwrap(await remote.read(sessionId, file.path, { offset: 1, limit }, controller.signal));
              const text = value && typeof value.text === 'string' ? value.text : '';
              if (!alive) return;
              setState({ status: file.kind, text });
              return;
            }
            if (alive) setState({ status: 'file' });
          } catch (error) {
            fail(error);
          }
        })();
        return () => {
          alive = false;
          controller.abort();
        };
      }, [file.path, file.kind, file.ext, sessionId]);

      if (state.status === 'loading') return h(Note, null, t('file.loading'));
      if (state.status === 'error') return h(Note, null, t('file.failed') + ' · ' + state.message);
      if (state.status === 'image') {
        return h('img', { src: state.url, alt: file.path, title: file.path, onClick: () => openFile(sessionId, file.path) });
      }
      if (state.status === 'html') {
        return h(ScaledFrame, { title: file.path, html: state.text });
      }
      if (state.status === 'text') {
        const lines = state.text.split(/\r?\n/);
        const shown = lines.slice(0, MAX_TEXT_PREVIEW_LINES).join('\n');
        return h(
          React.Fragment,
          null,
          h('pre', null, shown),
          lines.length > MAX_TEXT_PREVIEW_LINES ? h(Note, null, t('file.lines', { n: MAX_TEXT_PREVIEW_LINES })) : null,
        );
      }
      return h(Note, null, t('file.unsupported'));
    }

    function FileCard({ file, sessionId, t }) {
      const cut = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\'));
      const name = cut >= 0 ? file.path.slice(cut + 1) : file.path;
      return h(
        'div',
        { className: 'ob-file' },
        h(
          'div',
          {
            className: 'ob-file-head',
            role: 'button',
            tabIndex: 0,
            title: file.path,
            onClick: () => openFile(sessionId, file.path),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openFile(sessionId, file.path);
              }
            },
          },
          h('span', { className: 'ob-file-name' }, name),
        ),
        h('div', { className: 'ob-file-body' }, h(FileBody, { file, sessionId, t })),
      );
    }

    function openFile(sessionId, path) {
      const sidebar = ctxRef.get('sidebarRight');
      if (!sidebar) return;
      try {
        sidebar.openResource(fileAddress(sessionId, path));
      } catch (error) {
        console.error('[option-brief] could not open the file preview', error);
      }
    }

    function FileList({ files, sessionId, t, label }) {
      if (!files || files.length === 0) return null;
      return h(
        'div',
        { className: 'ob-files' },
        label ? h('div', { className: 'ob-files-label' }, label) : null,
        files.map((file, index) => h(FileCard, { key: index, file, sessionId, t })),
      );
    }

    function OptionCard({ option, index, sessionId, t }) {
      const badge = String(index + 1);
      const description = cleanDescription(option.description);
      return h(
        'div',
        { className: 'ob-option' },
        h(
          'div',
          { className: 'ob-option-head' },
          h('span', { className: 'ob-badge' }, badge),
          h('span', { className: 'ob-label' }, option.label),
        ),
        description !== '' ? h('div', { className: 'ob-desc' }, description) : null,
        h(FileList, { files: option.files, sessionId, t, label: t('question.files') }),
      );
    }

    function BriefBody(props) {
      const value = useSnapshot();
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const brief = value.brief;

      if (!brief) {
        return h(
          'div',
          { className: 'ob-root' },
          h('style', null, CSS),
          h(
            'div',
            { className: 'ob-empty' },
            h('strong', null, t('empty.title')),
            h('span', null, t('empty.body')),
          ),
        );
      }

      const sessionId = brief.sessionId;
      const kicker = brief.kind === 'plan-review' ? t('question.planReview') : brief.kind === 'approval' ? t('approval.title') : t('tab.title');

      return h(
        'div',
        { className: 'ob-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'ob-head' },
          h('div', { className: 'ob-kicker' }, kicker),
          brief.title !== '' ? h('div', { className: 'ob-title' }, brief.title) : null,
        ),
        h(FileList, { files: brief.presented, sessionId, t, label: t('panel.presented') }),
        brief.kind === 'approval'
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'ob-detail' },
                (brief.toolName !== '' ? t('approval.tool') + '：' + brief.toolName + '\n' : '') + brief.detail,
              ),
              h(FileList, { files: brief.files, sessionId, t, label: t('question.files') }),
            )
          : null,
        (brief.questions || []).map((question, questionIndex) =>
          h(
            'div',
            { key: questionIndex, className: 'ob-head' },
            question.question !== '' ? h('div', { className: 'ob-question' }, question.question) : null,
            h(FileList, { files: question.detailFiles, sessionId, t, label: t('question.detail') }),
            question.detail !== '' ? h('div', { className: 'ob-detail' }, question.detail) : null,
            question.options && question.options.length > 0
              ? h(
                  'div',
                  { className: 'ob-options' },
                  question.options.map((option, optionIndex) =>
                    h(OptionCard, { key: optionIndex, option, index: optionIndex, sessionId, t }),
                  ),
                )
              : null,
          ),
        ),
      );
    }

    function BriefTitle(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      return h('span', null, t('tab.title'));
    }

    // ---------------------------------------------------------------------
    // Watcher: the pending-interaction source drives open/close.
    // ---------------------------------------------------------------------

    let ctxRef = null;

    function questionsBrief(sessionId, questions) {
      const planReview = questions.some((question) => question && question.intent && question.intent.kind === 'plan-review');
      const first = questions[0] || {};
      const title = typeof first.header === 'string' && first.header !== '' ? first.header : typeof first.question === 'string' ? first.question : '';
      return {
        kind: planReview ? 'plan-review' : 'question',
        sessionId,
        title: String(title).slice(0, 200),
        questions: questions.map((question) => {
          if (!question || typeof question !== 'object') return { question: '', detail: '', detailFiles: [], options: [] };
          const detail = typeof question.detail === 'string' ? question.detail : '';
          const options = Array.isArray(question.options)
            ? question.options.map((option) => {
                const label = option && typeof option.label === 'string' ? option.label : '';
                const description = option && typeof option.description === 'string' ? option.description : '';
                return { label, description, files: extractPaths(description) };
              })
            : [];
          return {
            question: typeof question.question === 'string' ? question.question : '',
            detail,
            detailFiles: extractPaths(detail),
            options,
          };
        }),
      };
    }

    function approvalBrief(sessionId, interaction) {
      const reason = typeof interaction.reason === 'string' ? interaction.reason : '';
      const display = interaction.displayReason;
      const shown =
        display && typeof display === 'object'
          ? typeof display.zh === 'string'
            ? display.zh
            : typeof display.en === 'string'
              ? display.en
              : ''
          : '';
      const detail = [shown, reason].filter((part) => typeof part === 'string' && part !== '').join('\n');
      return {
        kind: 'approval',
        sessionId,
        title: typeof interaction.toolName === 'string' ? interaction.toolName : '',
        toolName: typeof interaction.toolName === 'string' ? interaction.toolName : '',
        detail,
        files: extractPaths(detail),
        questions: [],
      };
    }

    /** Parse one tool call's arguments: native calls carry JSON text, PTC dispatches carry an object. */
    function toolArguments(value) {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch (_error) {
          return undefined;
        }
      }
      return value !== null && typeof value === 'object' ? value : undefined;
    }

    /** File paths one `present` call carried, in the order the card listed them. */
    function presentPaths(event) {
      if (!event || typeof event !== 'object') return [];
      if (event.type !== 'tool/call' && event.type !== 'tool/ptc-dispatch') return [];
      const data = event.data;
      if (!data || typeof data !== 'object' || data.name !== 'present') return [];
      const args = toolArguments(data.arguments);
      if (!args || !Array.isArray(args.files)) return [];
      const paths = [];
      for (const file of args.files) {
        const path = file && typeof file === 'string' ? file : file && typeof file.path === 'string' ? file.path : '';
        if (path !== '') paths.push(path);
      }
      return paths;
    }

    /**
     * Files the assistant presented in the message body right before this question.
     * The question payload only carries option descriptions, and a `present` card
     * never names its file there — so the panel reads the Session log instead and
     * lifts the latest presented files in, newest first.
     */
    async function loadPresentedFiles(ctx, sessionId, signal) {
      const files = [];
      const seen = new Set();
      const take = (raw, seq) => {
        const path = tidyPath(raw);
        const key = path.toLowerCase();
        if (path === '' || seen.has(key)) return;
        seen.add(key);
        files.push({ path, ext: extensionOf(path), kind: kindOf(path), seq: typeof seq === 'number' ? seq : 0 });
      };
      let remote;
      try {
        remote = ctx.get('remote.session');
      } catch (_error) {
        remote = undefined;
      }
      if (!remote || typeof remote.follow !== 'function') return files;
      const address = { kind: 'session', sessionId };
      let snapshot;
      for await (const frame of remote.follow({ address }, signal)) {
        if (frame && frame.type === 'snapshot') {
          snapshot = frame;
          break;
        }
      }
      if (!snapshot) return files;
      let page = { records: Array.isArray(snapshot.records) ? snapshot.records : [], hasMore: snapshot.hasMore === true };
      for (let guard = 0; guard < 4 && page.records.length > 0; guard += 1) {
        for (let index = page.records.length - 1; index >= 0; index -= 1) {
          const record = page.records[index];
          const event = record && record.event;
          const seq = event && typeof event.seq === 'number' ? event.seq : 0;
          for (const path of presentPaths(event)) take(path, seq);
          if (files.length >= MAX_PRESENTED_FILES) break;
        }
        if (files.length > 0 || !page.hasMore || snapshot.cursor === undefined) break;
        const first = page.records[0];
        const beforeSeq = first && first.event ? first.event.seq : undefined;
        if (beforeSeq === undefined) break;
        const next = await remote.page({ address, throughSeq: snapshot.cursor, beforeSeq }, signal);
        if (!next || !next.ok) break;
        page = next.value || { records: [], hasMore: false };
      }
      // A presented path can be stale (the file moved or was deleted since the
      // message); keep only the ones the Host can still stat.
      const existing = [];
      const filesRemote = (() => {
        try {
          return ctx.get('remote.workspaceFiles');
        } catch (_error) {
          return undefined;
        }
      })();
      for (const file of files.slice(0, MAX_PRESENTED_FILES)) {
        if (!filesRemote || typeof filesRemote.stat !== 'function') {
          existing.push(file);
          continue;
        }
        try {
          const stat = unwrap(await filesRemote.stat(sessionId, file.path, signal));
          if (stat && typeof stat.absolutePath === 'string') existing.push({ ...file, path: stat.absolutePath.replace(/\\/g, '/') });
        } catch (_error) {
          // missing or unreadable — leave it out rather than showing a broken card
        }
      }
      return existing;
    }

    /**
     * Put each presented file under the option it illustrates. An agent that
     * presents one sample per choice does it in option order, so equal counts map
     * by position; anything that cannot be mapped stays in the panel-level list.
     */
    function assignPresented(brief, presented) {
      if (!brief || !Array.isArray(presented) || presented.length === 0) return brief;
      const questions = Array.isArray(brief.questions) ? brief.questions : [];
      const options = [];
      const referenced = new Set();
      for (const question of questions) {
        for (const option of question.options || []) {
          options.push(option);
          for (const file of option.files || []) referenced.add(file.path.toLowerCase());
        }
        for (const file of question.detailFiles || []) referenced.add(file.path.toLowerCase());
      }
      const ordered = presented.slice().sort((left, right) => (left.seq || 0) - (right.seq || 0));
      const candidates = ordered.filter((file) => !referenced.has(file.path.toLowerCase()));
      if (candidates.length === 0) return { ...brief, presented: [] };
      const emptyOptions = options.filter((option) => !option.files || option.files.length === 0);
      const target = candidates.length === emptyOptions.length && emptyOptions.length > 0 ? emptyOptions : candidates.length === options.length && options.length > 0 ? options : null;
      if (target === null) return { ...brief, presented };
      target.forEach((option, index) => {
        const file = candidates[index];
        option.files = (option.files || []).concat([{ path: file.path, ext: file.ext, kind: file.kind }]);
      });
      return { ...brief, presented: [] };
    }

    function safeTabs(ctx, sessionId) {
      try {
        const tabs = ctx.sidebarRight.tabsIn(sessionId);
        return Array.isArray(tabs) ? tabs : [];
      } catch (_error) {
        return [];
      }
    }

    function watch(ctx) {
      let current = null;
      let closingSelf = false;
      const dismissed = new Set();
      let presentedAbort = null;
      let presentedKey = null;

      const onScreen = () => {
        try {
          return ctx.sidebarRight.mounted.getSnapshot();
        } catch (_error) {
          return undefined;
        }
      };

      const interactionOf = (sessionId) => {
        try {
          const statuses = ctx.uiSession.sessionStatus.getSnapshot();
          const status = statuses && typeof statuses.get === 'function' ? statuses.get(sessionId) : undefined;
          return status ? status.pendingInteraction : undefined;
        } catch (_error) {
          return undefined;
        }
      };

      const closeOurs = (sessionId) => {
        const tabs = safeTabs(ctx, sessionId);
        const mine = tabs.filter((tab) => tab && tab.kind === KIND);
        for (const tab of mine) {
          closingSelf = true;
          try {
            ctx.sidebarRight.close(tab.id);
          } catch (error) {
            console.error('[option-brief] could not close the tab', error);
          } finally {
            closingSelf = false;
          }
        }
        if (tabs.length - mine.length <= 1) {
          const layout = ctx.get('layout');
          if (layout && typeof layout.closeRightbar === 'function') {
            try {
              layout.closeRightbar();
            } catch (_error) {
              // the column is already collapsed
            }
          }
        }
      };

      const openOurs = (key) => {
        try {
          ctx.sidebarRight.openTab(KIND, { params: { key } });
        } catch (_error) {
          try {
            ctx.sidebarRight.openTab(KIND);
          } catch (fallbackError) {
            console.error('[option-brief] could not open the tab', fallbackError);
          }
        }
        try {
          if (!ctx.sidebarRight.isExpanded()) {
            const layout = ctx.get('layout');
            if (layout && typeof layout.openRightbar === 'function') layout.openRightbar(true, false);
          }
        } catch (_error) {
          // the column reports its own state
        }
      };

      const sync = () => {
        const sessionId = onScreen();
        if (sessionId === undefined) {
          if (current) {
            closeOurs(current.sessionId);
            current = null;
          }
          publish({ status: 'idle', brief: null });
          return;
        }
        const interaction = interactionOf(sessionId);
        if (!interaction) {
          if (current) {
            closeOurs(current.sessionId);
            current = null;
          }
          publish({ status: 'waiting', brief: null });
          return;
        }
        let brief;
        if (interaction.kind === 'approval') {
          brief = approvalBrief(sessionId, interaction);
        } else {
          const questions = Array.isArray(interaction.questions) ? interaction.questions : [];
          if (questions.length === 0) {
            publish({ status: 'waiting', brief: null });
            return;
          }
          brief = questionsBrief(sessionId, questions);
        }
        brief.presented = [];
        const key = String(interaction.key || interaction.callId || interaction.kind);
        brief.key = key;
        publish({ status: 'ready', brief });
        if (presentedKey !== key) {
          presentedKey = key;
          if (presentedAbort) presentedAbort.abort();
          presentedAbort = new AbortController();
          const controller = presentedAbort;
          loadPresentedFiles(ctx, sessionId, controller.signal)
            .then((files) => {
              if (controller.signal.aborted || files.length === 0) return;
              const live = snapshot.brief;
              if (!live || live.key !== key) return;
              publish({ status: 'ready', brief: assignPresented(live, files) });
            })
            .catch((error) => {
              if (!controller.signal.aborted) console.error('[option-brief] could not read the presented files', error);
            });
        }
        if (dismissed.has(key)) return;
        if (current && current.key === key) return;
        current = { sessionId, key };
        openOurs(key);
      };

      sync();
      const stopStatus = ctx.uiSession.sessionStatus.subscribe(sync);
      const stopMounted = ctx.sidebarRight.mounted.subscribe(sync);
      const stopClose = ctx.sidebarRight.registerCloseHandler(KIND, () => {
        if (closingSelf) return;
        if (current) dismissed.add(current.key);
      });

      return () => {
        stopStatus();
        stopMounted();
        stopClose();
        if (presentedAbort) presentedAbort.abort();
      };
    }

    // Locale dictionaries are inlined so the bundle needs no JSON import.
    const locale = {
      zh: {
        'tab.title': '选项详情',
        'guide.hint': '我提问时自动弹出；也可以从这里手动打开。',
        'empty.title': '现在没有待选的问题',
        'empty.body': '下次我用 Q&A 问你、或者请求你批准时，这里会自动列出每个选项的说明和样例。',
        'question.files': '样例文件',
        'panel.presented': '其他正文产物',
        'question.detail': '详细说明',
        'question.planReview': '计划审阅',
        'file.open': '在侧栏打开',
        'file.loading': '正在读取…',
        'file.failed': '预览失败',
        'file.missing': '找不到这个文件，或没有权限读取',
        'file.unsupported': '这个格式先不内嵌预览，点名字在侧栏打开',
        'file.lines': '只显示前 {n} 行',
        'approval.title': '待批准的请求',
        'approval.tool': '工具',
        'approval.reason': '理由',
      },
      en: {
        'tab.title': 'Option brief',
        'guide.hint': 'Opens by itself when I ask with options; open it from here any time.',
        'empty.title': 'Nothing to choose right now',
        'empty.body': "Next time I ask you with options, or request an approval, this panel lists every option's description and samples.",
        'question.files': 'Sample files',
        'panel.presented': 'Other body files',
        'question.detail': 'Details',
        'question.planReview': 'Plan review',
        'file.open': 'Open in sidebar',
        'file.loading': 'Reading…',
        'file.failed': 'Preview failed',
        'file.missing': 'File not found or not readable',
        'file.unsupported': 'No inline preview for this format; click the name to open it',
        'file.lines': 'First {n} lines only',
        'approval.title': 'Pending approval',
        'approval.tool': 'Tool',
        'approval.reason': 'Reason',
      },
    };

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    const inject = ['slots', 'locale', 'remote', 'remote.session', 'uiSession', 'sidebarRight', 'sidebarRightTabs'];

    function apply(ctx) {
      ctxRef = ctx;
      const t = ctx.locale.bind(NS);

      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh: locale.zh,
            en: locale.en,
          }),
        'option-brief: dictionaries',
      );

      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: TYPE_ID,
            kind: KIND,
            title: () => t('tab.title'),
            guide: [
              {
                id: 'option-brief-guide',
                order: 40,
                title: () => t('tab.title'),
                description: () => t('guide.hint'),
              },
            ],
          }),
        'option-brief: tab type',
      );

      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TYPE_ID, locale: NS }, BriefBody),
      );
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TYPE_ID, locale: NS }, BriefTitle),
      );

      ctx.effect(() => watch(ctx), 'option-brief: pending-interaction watcher');
    }

    return { name: 'dsh-sidebar-options', inject, apply };
  },
});