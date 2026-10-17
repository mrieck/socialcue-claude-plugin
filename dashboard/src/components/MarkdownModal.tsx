import { useEffect } from 'react';
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from '@mdxeditor/editor';

interface Props {
  value: string;
  onChange: (md: string) => void;
  onClose: () => void;
  title?: string;
  readOnly?: boolean;
}

/** Full-screen WYSIWYG markdown editor for a Content Library post body. */
export default function MarkdownModal({ value, onChange, onClose, title, readOnly }: Props) {
  useEffect(() => {
    // Radix popups inside the editor (block-type select, link dialog) consume Escape
    // and mark it defaultPrevented; only close the modal when nothing else handled it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dark = document.documentElement.getAttribute('data-theme') !== 'light';

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card editor-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title || '(untitled)'}{readOnly && <span className="badge badge-source">read-only</span>}</h2>
          <button className="copy" type="button" onClick={onClose}>{readOnly ? "Close" : "Save & close"}</button>
        </div>
        <MDXEditor
          className={`md-editor mdxeditor-full-height${dark ? ' dark-theme dark-editor' : ''}`}
          contentEditableClassName="md-editor-content"
          markdown={value}
          readOnly={readOnly}
          onChange={onChange}
          plugins={[
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            linkPlugin(),
            linkDialogPlugin(),
            imagePlugin(),
            tablePlugin(),
            codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
            codeMirrorPlugin({
              codeBlockLanguages: { '': 'plain', md: 'Markdown', js: 'JavaScript', ts: 'TypeScript', bash: 'Bash', json: 'JSON' },
            }),
            markdownShortcutPlugin(),
            diffSourcePlugin({ viewMode: 'rich-text', diffMarkdown: value }),
            toolbarPlugin({
              toolbarContents: () => (
                <DiffSourceToggleWrapper>
                  <UndoRedo />
                  <BoldItalicUnderlineToggles />
                  <CodeToggle />
                  <BlockTypeSelect />
                  <ListsToggle />
                  <CreateLink />
                  <InsertImage />
                  <InsertTable />
                  <InsertThematicBreak />
                  <InsertCodeBlock />
                </DiffSourceToggleWrapper>
              ),
            }),
          ]}
        />
      </div>
    </div>
  );
}
