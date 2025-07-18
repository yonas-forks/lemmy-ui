import { communitySearch, personSearch } from "@utils/app";
import { debounce, groupBy } from "@utils/helpers";
import { CommunityTribute, PersonTribute } from "@utils/types";
import { Picker } from "emoji-mart";
import emojiShortName from "emoji-short-name";
import { CustomEmojiView } from "lemmy-js-client";
import { default as MarkdownIt } from "markdown-it";
import markdown_it_container from "markdown-it-container";
// import markdown_it_emoji from "markdown-it-emoji/bare";
import markdown_it_bidi from "markdown-it-bidi";
import markdown_it_footnote from "markdown-it-footnote";
import markdown_it_html5_embed from "markdown-it-html5-embed";
import markdown_it_ruby from "markdown-it-ruby";
import markdown_it_sub from "markdown-it-sub";
import markdown_it_sup from "markdown-it-sup";
import markdown_it_highlightjs from "markdown-it-highlightjs/core";
import { Renderer, Token } from "markdown-it";
import { instanceLinkRegex, relTags } from "./config";
import { lazyHighlightjs } from "./lazy-highlightjs";
import { HttpService } from "./services";
import { WrappedLemmyHttp } from "./services/HttpService";

let Tribute: any;

export let md: MarkdownIt = new MarkdownIt();

export let mdNoImages: MarkdownIt = new MarkdownIt();

// Zero disables all rules.
// Only explicitly allow a limited set of rules safe for use in post titles.
export const mdLimited: MarkdownIt = new MarkdownIt("zero").enable([
  "emphasis",
  "backticks",
  "strikethrough",
]);

let customEmojis: EmojiMartCategory[] = [];

export let customEmojisLookup: Map<string, CustomEmojiView> = new Map<
  string,
  CustomEmojiView
>();

export function mdToHtml(text: string, rerender: () => void) {
  return { __html: lazyHighlightjs.render(md, text, rerender) };
}

export function mdToHtmlNoImages(text: string, rerender: () => void) {
  return { __html: lazyHighlightjs.render(mdNoImages, text, rerender) };
}

export function mdToHtmlInline(text: string) {
  return { __html: mdLimited.renderInline(text) };
}

const spoilerConfig = {
  validate: (params: string) => {
    return params.trim().match(/^spoiler\s+(.*)$/);
  },

  render: (tokens: any, idx: any) => {
    const m = tokens[idx].info.trim().match(/^spoiler\s+(.*)$/);
    if (tokens[idx].nesting === 1) {
      // opening tag
      const summary = mdToHtmlInline(m[1]).__html;
      return `<details><summary> ${summary} </summary>\n`;
    } else {
      // closing tag
      return "</details>\n";
    }
  },
};

const highlightjsConfig = {
  inline: true,
  hljs: lazyHighlightjs.hljs,
  auto: true,
  code: true,
  ignoreIllegals: true,
};

const html5EmbedConfig = {
  html5embed: {
    useImageSyntax: true, // Enables video/audio embed with ![]() syntax (default)
    attributes: {
      audio: 'controls preload="metadata"',
      video: 'width="100%" max-height="100%" controls loop preload="metadata"',
    },
  },
};

function localInstanceLinkParser(md: MarkdownIt) {
  md.core.ruler.push("replace-text", state => {
    for (let i = 0; i < state.tokens.length; i++) {
      if (state.tokens[i].type !== "inline") {
        continue;
      }
      const inlineTokens: Token[] = state.tokens[i].children || [];
      for (let j = inlineTokens.length - 1; j >= 0; j--) {
        if (
          inlineTokens[j].type === "text" &&
          new RegExp(instanceLinkRegex).test(inlineTokens[j].content)
        ) {
          const text = inlineTokens[j].content;
          const matches = Array.from(text.matchAll(instanceLinkRegex));

          let lastIndex = 0;
          const newTokens: Token[] = [];

          let linkClass = "community-link";

          for (const match of matches) {
            // If there is plain text before the match, add it as a separate token
            if (match.index !== undefined && match.index > lastIndex) {
              const textToken = new state.Token("text", "", 0);
              textToken.content = text.slice(lastIndex, match.index);
              newTokens.push(textToken);
            }

            let href: string;
            if (match[0].startsWith("!")) {
              href = "/c/" + match[0].substring(1);
            } else if (match[0].startsWith("@")) {
              href = "/u/" + match[0].substring(1);
              linkClass = "user-link";
            } else if (match[0].startsWith("/m/")) {
              href = "/c/" + match[0].substring(3);
            } else {
              href = match[0];
              if (match[0].startsWith("/u/")) {
                linkClass = "user-link";
              }
            }

            const linkOpenToken = new state.Token("link_open", "a", 1);
            linkOpenToken.attrs = [
              ["href", href],
              ["class", linkClass],
            ];
            const textToken = new state.Token("text", "", 0);
            textToken.content = match[0];
            const linkCloseToken = new state.Token("link_close", "a", -1);

            newTokens.push(linkOpenToken, textToken, linkCloseToken);

            lastIndex =
              (match.index !== undefined ? match.index : 0) + match[0].length;
          }

          // If there is plain text after the last match, add it as a separate token
          if (lastIndex < text.length) {
            const textToken = new state.Token("text", "", 0);
            textToken.content = text.slice(lastIndex);
            newTokens.push(textToken);
          }

          inlineTokens.splice(j, 1, ...newTokens);
        }
      }
    }
  });
}

export function setupMarkdown() {
  const markdownItConfig: MarkdownIt.Options = {
    html: false,
    linkify: true,
    typographer: true,
  };

  // const emojiDefs = Array.from(customEmojisLookup.entries()).reduce(
  //   (main, [key, value]) => ({ ...main, [key]: value }),
  //   {}
  // );
  md = new MarkdownIt(markdownItConfig)
    .use(markdown_it_sub)
    .use(markdown_it_sup)
    .use(markdown_it_footnote)
    .use(markdown_it_html5_embed, html5EmbedConfig)
    .use(markdown_it_container, "spoiler", spoilerConfig)
    .use(markdown_it_highlightjs, highlightjsConfig)
    .use(markdown_it_ruby)
    .use(localInstanceLinkParser)
    .use(markdown_it_bidi);
  // .use(markdown_it_emoji, {
  //   defs: emojiDefs,
  // });

  mdNoImages = new MarkdownIt(markdownItConfig)
    .use(markdown_it_sub)
    .use(markdown_it_sup)
    .use(markdown_it_footnote)
    .use(markdown_it_html5_embed, html5EmbedConfig)
    .use(markdown_it_container, "spoiler", spoilerConfig)
    .use(markdown_it_highlightjs, highlightjsConfig)
    .use(localInstanceLinkParser)
    .use(markdown_it_bidi)
    // .use(markdown_it_emoji, {
    //   defs: emojiDefs,
    // })
    .disable("image");
  const defaultImageRenderer = md.renderer.rules.image;
  md.renderer.rules.image = function (
    tokens: Token[],
    idx: number,
    options: MarkdownIt.Options,
    env: any,
    self: Renderer,
  ) {
    //Provide custom renderer for our emojis to allow us to add a css class and force size dimensions on them.
    const item = tokens[idx] as any;
    const title = item.attrs.length > 2 ? item.attrs[2][1] : "";
    const splitTitle = title.split(/ (.*)/, 2);
    const isEmoji = splitTitle[0] === "emoji";
    const imgElement =
      defaultImageRenderer?.(tokens, idx, options, env, self) ?? "";
    if (imgElement) {
      return isEmoji
        ? `<span class="icon icon-emoji">${imgElement}</span>`
        : imgElement;
    }
    return "";
  };
  md.renderer.rules.table_open = function () {
    return '<table class="table">';
  };
  const defaultLinkRenderer =
    md.renderer.rules.link_open ||
    function (tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options);
    };
  md.renderer.rules.link_open = function (
    tokens: Token[],
    idx: number,
    options: MarkdownIt.Options,
    env: any,
    self: Renderer,
  ) {
    tokens[idx].attrPush(["rel", relTags]);
    return defaultLinkRenderer(tokens, idx, options, env, self);
  };
}

export function emojiMartCategories(
  custom_emoji_views: CustomEmojiView[],
): EmojiMartCategory[] {
  const groupedEmojis = groupBy(
    custom_emoji_views,
    x => x.custom_emoji.category,
  );
  const customEmojis: EmojiMartCategory[] = [];
  for (const [category, emojis] of Object.entries(groupedEmojis)) {
    customEmojis.push({
      id: category,
      name: category,
      emojis: emojis.map(emoji => ({
        id: emoji.custom_emoji.shortcode,
        name: emoji.custom_emoji.shortcode,
        keywords: emoji.keywords.map(x => x.keyword),
        skins: [{ src: emoji.custom_emoji.image_url }],
      })),
    });
  }
  return customEmojis;
}

export async function setupEmojiDataModel(
  client: WrappedLemmyHttp = HttpService.client,
): Promise<boolean> {
  const emojisRes = await client.listCustomEmojis({
    ignore_page_limits: true,
  });
  if (emojisRes.state !== "success") {
    return false;
  }
  const custom_emoji_views = emojisRes.data.custom_emojis;
  customEmojis = emojiMartCategories(custom_emoji_views);
  customEmojisLookup = new Map(
    custom_emoji_views.map(view => [view.custom_emoji.shortcode, view]),
  );
  return true;
}

export function getEmojiMart(
  onEmojiSelect: (e: any) => void,
  customPickerOptions: any = {},
) {
  const pickerOptions = {
    onEmojiSelect: onEmojiSelect,
    custom: customEmojis,
    ...customPickerOptions,
  };
  return new Picker(pickerOptions);
}

export async function setupTribute() {
  // eslint-disable-next-line eqeqeq
  if (Tribute == null) {
    console.debug("Tribute is null, importing...");
    Tribute = (await import("tributejs")).default;
  }

  return new Tribute({
    noMatchTemplate: function () {
      return "";
    },
    collection: [
      // Emojis
      {
        trigger: ":",
        menuItemTemplate: (item: any) => {
          const shortName = `:${item.original.key}:`;
          return `${item.original.val} ${shortName}`;
        },
        selectTemplate: (item: any) => {
          const customEmoji = customEmojisLookup.get(
            item.original.key,
          )?.custom_emoji;
          if (customEmoji === undefined) return `${item.original.val}`;
          else
            return `![${customEmoji.alt_text}](${customEmoji.image_url} "emoji ${customEmoji.shortcode}")`;
        },
        values: Object.entries(emojiShortName)
          .map(e => {
            return { key: e[1], val: e[0] };
          })
          .concat(
            Array.from(customEmojisLookup.entries()).map(k => ({
              key: k[0],
              val: `<img class="icon icon-emoji" src="${md.utils.escapeHtml(k[1].custom_emoji.image_url)}" title="${md.utils.escapeHtml(k[1].custom_emoji.shortcode)}" alt="${md.utils.escapeHtml(k[1].custom_emoji.alt_text)}" />`,
            })),
          ),
        allowSpaces: false,
        autocompleteMode: true,
        // TODO
        // menuItemLimit: mentionDropdownFetchLimit,
        menuShowMinLength: 2,
      },
      // Persons
      {
        trigger: "@",
        selectTemplate: (item: any) => {
          const it: PersonTribute = item.original;
          return `[${it.key}](${it.view.person.actor_id})`;
        },
        values: debounce(async (text: string, cb: any) => {
          cb(await personSearch(text));
        }),
        allowSpaces: false,
        autocompleteMode: true,
        // TODO
        // menuItemLimit: mentionDropdownFetchLimit,
        menuShowMinLength: 2,
      },

      // Communities
      {
        trigger: "!",
        selectTemplate: (item: any) => {
          const it: CommunityTribute = item.original;
          return `[${it.key}](${it.view.community.actor_id})`;
        },
        values: debounce(async (text: string, cb: any) => {
          cb(await communitySearch(text));
        }),
        allowSpaces: false,
        autocompleteMode: true,
        // TODO
        // menuItemLimit: mentionDropdownFetchLimit,
        menuShowMinLength: 2,
      },
    ],
  });
}

export interface EmojiMartCategory {
  id: string;
  name: string;
  emojis: EmojiMartCustomEmoji[];
}

interface EmojiMartCustomEmoji {
  id: string;
  name: string;
  keywords: string[];
  skins: EmojiMartSkin[];
}

interface EmojiMartSkin {
  src: string;
}
