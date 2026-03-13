import { memo, useMemo, type ReactNode } from "react";
import type { EditorId } from "@codex-realtime/contracts";
import { openInPreferredEditor } from "../editor-preferences";
import { resolveMarkdownFileLinkTarget } from "../markdown-links";
import { readNativeApi } from "../native-api";

type TimelineRichTextProps = {
  text: string;
  className?: string;
  cwd?: string;
  availableEditors?: readonly EditorId[];
};

type RichTextBlock =
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "ordered-list" | "unordered-list";
      items: string[];
    }
  | {
      type: "code-block";
      text: string;
    };

const ORDERED_LIST_PATTERN = /^\s*\d+\.\s+(.*)$/;
const UNORDERED_LIST_PATTERN = /^\s*[-*]\s+(.*)$/;
const FENCE_PATTERN = /^\s*```/;
const INLINE_TOKEN_PATTERN =
  /\[([^\]\n]+)\]\(([^)\n]+)\)|`([^`\n]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;

type InlineRenderContext = {
  cwd?: string;
  availableEditors: readonly EditorId[];
};

const isBlankLine = (line: string) => line.trim().length === 0;

const isOrderedListItem = (line: string) => ORDERED_LIST_PATTERN.test(line);

const isUnorderedListItem = (line: string) => UNORDERED_LIST_PATTERN.test(line);

const isBlockBoundary = (line: string) =>
  isBlankLine(line) || FENCE_PATTERN.test(line) || isOrderedListItem(line) || isUnorderedListItem(line);

const appendLineBreaks = (text: string, keyPrefix: string): ReactNode[] =>
  text.split("\n").flatMap((segment, index) =>
    index === 0 ? [segment] : [<br key={`${keyPrefix}-br-${index}`} />, segment]
  );

const renderInlineContent = (
  text: string,
  keyPrefix: string,
  context: InlineRenderContext
): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN_PATTERN)) {
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      nodes.push(...appendLineBreaks(text.slice(lastIndex, matchIndex), `${keyPrefix}-text-${lastIndex}`));
    }

    const markdownLinkLabel = match[1];
    const markdownLinkHref = match[2];
    const inlineCode = match[3];
    const strongText = match[4] ?? match[5];
    const emphasisText = match[6] ?? match[7];
    const tokenKey = `${keyPrefix}-token-${matchIndex}`;

    if (markdownLinkLabel !== undefined && markdownLinkHref !== undefined) {
      const targetPath = resolveMarkdownFileLinkTarget(markdownLinkHref, context.cwd);

      nodes.push(
        <a
          key={tokenKey}
          className="timeline-rich-text-link"
          href={markdownLinkHref}
          onClick={(event) => {
            if (!targetPath) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();

            const api = readNativeApi();
            if (!api) {
              console.warn("Native API not found. Unable to open file in editor.");
              return;
            }

            void openInPreferredEditor(api, targetPath, context.availableEditors).catch((error) => {
              console.warn("Unable to open file in preferred editor.", error);
            });
          }}
          rel={targetPath ? undefined : "noreferrer"}
          target={targetPath ? undefined : "_blank"}
        >
          {renderInlineContent(markdownLinkLabel, tokenKey, context)}
        </a>
      );
    } else if (inlineCode !== undefined) {
      nodes.push(
        <code key={tokenKey} className="timeline-rich-text-inline-code">
          {inlineCode}
        </code>
      );
    } else if (strongText !== undefined) {
      nodes.push(<strong key={tokenKey}>{renderInlineContent(strongText, tokenKey, context)}</strong>);
    } else if (emphasisText !== undefined) {
      nodes.push(<em key={tokenKey}>{renderInlineContent(emphasisText, tokenKey, context)}</em>);
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(...appendLineBreaks(text.slice(lastIndex), `${keyPrefix}-tail`));
  }

  return nodes.length > 0 ? nodes : appendLineBreaks(text, `${keyPrefix}-plain`);
};

const collectListItems = (
  lines: string[],
  startIndex: number,
  matcher: typeof ORDERED_LIST_PATTERN | typeof UNORDERED_LIST_PATTERN
) => {
  const items: string[] = [];
  let currentItem = "";
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const match = line.match(matcher);

    if (match) {
      if (currentItem) {
        items.push(currentItem);
      }
      currentItem = match[1].trim();
      index += 1;
      continue;
    }

    if (isBlankLine(line)) {
      break;
    }

    if (/^\s+/.test(line) && currentItem) {
      currentItem = `${currentItem}\n${line.trim()}`;
      index += 1;
      continue;
    }

    break;
  }

  if (currentItem) {
    items.push(currentItem);
  }

  return { items, nextIndex: index };
};

const parseBlocks = (text: string): RichTextBlock[] => {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const blocks: RichTextBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (isBlankLine(line)) {
      index += 1;
      continue;
    }

    if (FENCE_PATTERN.test(line)) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !FENCE_PATTERN.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && FENCE_PATTERN.test(lines[index])) {
        index += 1;
      }

      blocks.push({
        type: "code-block",
        text: codeLines.join("\n")
      });
      continue;
    }

    if (isOrderedListItem(line)) {
      const { items, nextIndex } = collectListItems(lines, index, ORDERED_LIST_PATTERN);
      blocks.push({
        type: "ordered-list",
        items
      });
      index = nextIndex;
      continue;
    }

    if (isUnorderedListItem(line)) {
      const { items, nextIndex } = collectListItems(lines, index, UNORDERED_LIST_PATTERN);
      blocks.push({
        type: "unordered-list",
        items
      });
      index = nextIndex;
      continue;
    }

    const paragraphLines = [line];
    index += 1;

    while (index < lines.length && !isBlockBoundary(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push({
      type: "paragraph",
      text: paragraphLines.join("\n")
    });
  }

  return blocks;
};

function TimelineRichTextComponent({
  text,
  className,
  cwd,
  availableEditors = []
}: TimelineRichTextProps) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const inlineContext = useMemo(
    () => ({
      cwd,
      availableEditors
    }),
    [availableEditors, cwd]
  );

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        if (block.type === "paragraph") {
          return (
            <p key={key} className="timeline-rich-text-paragraph">
              {renderInlineContent(block.text, key, inlineContext)}
            </p>
          );
        }

        if (block.type === "code-block") {
          return (
            <pre key={key} className="timeline-rich-text-code-block">
              <code>{block.text}</code>
            </pre>
          );
        }

        const listClassName =
          block.type === "ordered-list"
            ? "timeline-rich-text-list timeline-rich-text-list-ordered"
            : "timeline-rich-text-list timeline-rich-text-list-unordered";
        const ListTag = block.type === "ordered-list" ? "ol" : "ul";

        return (
          <ListTag key={key} className={listClassName}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-item-${itemIndex}`}>
                {renderInlineContent(item, `${key}-item-${itemIndex}`, inlineContext)}
              </li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}

export const TimelineRichText = memo(TimelineRichTextComponent);
TimelineRichText.displayName = "TimelineRichText";
