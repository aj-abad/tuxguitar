import { XMLValidator } from "fast-xml-parser";

/** A small editable XML tree retaining every untouched source token verbatim. */
export class SourceElement {
  constructor(public name: string, public opening: string, public closing = "", public content: Array<string | SourceElement> = []) {}
  elements(name: string): SourceElement[] {
    return this.content.filter((item): item is SourceElement => item instanceof SourceElement && item.name === name);
  }
  child(name: string, index = 0): SourceElement {
    const child = this.elements(name)[index];
    if (!child) throw new Error(`Cannot locate ${name} in the original file.`);
    return child;
  }
  insert(child: SourceElement, index = this.elements(child.name).length): void {
    if (/\/>$/.test(this.opening)) {
      this.opening = this.opening.replace(/\/>$/, ">");
      this.closing = `</${this.name}>`;
    }
    const next = this.elements(child.name)[index];
    this.content.splice(next ? this.content.indexOf(next) : this.content.length, 0, child);
  }
  remove(child: SourceElement): void {
    const index = this.content.indexOf(child);
    if (index < 0) throw new Error("Cannot remove a missing XML element.");
    this.content.splice(index, 1);
  }
  clone(): SourceElement {
    return new SourceElement(this.name, this.opening, this.closing, this.content.map(item => typeof item === "string" ? item : item.clone()));
  }
  replaceElements(name: string, elements: SourceElement[]): void {
    if (elements.length && /\/>$/.test(this.opening)) {
      this.opening = this.opening.replace(/\/>$/, ">");
      this.closing = `</${this.name}>`;
    }
    let index = 0;
    this.content = this.content.flatMap(item => item instanceof SourceElement && item.name === name
      ? index < elements.length ? [elements[index++]] : [] : [item]);
    this.content.push(...elements.slice(index));
  }
  attribute(name: string, value: string | number | boolean | null): void {
    // Match full attributes, including quoted '>' and names inside values.
    const pattern = /\s+([^\s=/>]+)\s*=\s*(["'])(.*?)\2/gs;
    for (const match of this.opening.matchAll(pattern)) {
      if (match[1] !== name) continue;
      if (value === null) this.opening = this.opening.slice(0, match.index) + this.opening.slice(match.index! + match[0].length);
      else {
        const start = match.index! + match[0].indexOf(match[2]!) + 1;
        this.opening = this.opening.slice(0, start) + escapeAttribute(String(value)) + this.opening.slice(start + match[3]!.length);
      }
      return;
    }
    if (value !== null) this.opening = this.opening.replace(/(\/?>)$/, ` ${name}="${escapeAttribute(String(value))}"$1`);
  }
  toString(): string { return this.opening + this.content.map(String).join("") + this.closing; }
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("<", "&lt;");
}

export function sourceElement(name: string, attributes: Record<string, string | number | boolean> = {}): SourceElement {
  const node = new SourceElement(name, `<${name}/>`);
  for (const [key, value] of Object.entries(attributes)) node.attribute(key, value);
  return node;
}

export function parseXmlSource(xml: string): SourceElement {
  if (XMLValidator.validate(xml) !== true) throw new Error("The original song XML is invalid.");
  const root = new SourceElement("", "");
  const stack = [root];
  let position = 0;
  while (position < xml.length) {
    const start = xml.indexOf("<", position);
    if (start < 0) { stack.at(-1)!.content.push(xml.slice(position)); break; }
    stack.at(-1)!.content.push(xml.slice(position, start));
    let end: number;
    const special = xml.startsWith("<!--", start) ? "-->" : xml.startsWith("<![CDATA[", start) ? "]]>" : xml.startsWith("<?", start) ? "?>" : null;
    if (special) {
      end = xml.indexOf(special, start) + special.length;
      if (end < start) throw new Error("Unclosed XML token.");
    } else {
      let quote = "";
      let brackets = 0;
      end = start + 1;
      for (; end < xml.length; end++) {
        const char = xml[end]!;
        if (quote) { if (char === quote) quote = ""; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === "[") brackets++;
        else if (char === "]") brackets--;
        else if (char === ">" && brackets === 0) { end++; break; }
      }
    }
    const token = xml.slice(start, end);
    if (special || token.startsWith("<!")) stack.at(-1)!.content.push(token);
    else if (token.startsWith("</")) {
      if (stack.length <= 1) throw new Error("Unexpected XML closing tag.");
      stack.pop()!.closing = token;
    } else {
      const name = /^<([^\s/>]+)/.exec(token)?.[1];
      if (!name) throw new Error("Invalid XML tag.");
      const node = new SourceElement(name, token);
      stack.at(-1)!.content.push(node);
      if (!token.endsWith("/>")) stack.push(node);
    }
    position = end;
  }
  if (stack.length !== 1) throw new Error("Unclosed XML element.");
  return root;
}
