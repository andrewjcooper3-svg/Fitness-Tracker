// A STRICT stub of the Scriptable API surface the widget is allowed to use.
//
// The previous stub invented DrawContext.fillRoundedRect, so the tests
// passed while the phone threw "dc.fillRoundedRect is not a function". A
// stub that answers to anything proves nothing. Every object here is
// wrapped in a Proxy that throws on any property the real API does not
// have, so calling something Scriptable does not provide fails here first.
//
// Surface taken from Scriptable's own docs (docs.scriptable.app).

const strict = (obj, name) => new Proxy(obj, {
  get(t, prop) {
    if (prop in t) return t[prop];
    if (typeof prop === 'symbol' || prop === 'then' || prop === 'inspect') return undefined;
    throw new TypeError(`${name}.${String(prop)} is not part of the Scriptable API`);
  }
});

export function makeScriptable({ body, statusCode = 200, family = 'medium', drawn = [] }) {
  class Txt {
    constructor(s) { drawn.push(s); }
    set font(v) {} set textColor(v) {} set lineLimit(v) {} set minimumScaleFactor(v) {}
    set textOpacity(v) {} set shadowColor(v) {} set shadowRadius(v) {} set shadowOffset(v) {}
    set url(v) {} leftAlignText() {} centerAlignText() {} rightAlignText() {}
  }
  class Img {
    set imageSize(v) {} set cornerRadius(v) {} set borderWidth(v) {} set borderColor(v) {}
    set containerRelativeShape(v) {} set tintColor(v) {} set url(v) {} set resizable(v) {}
    leftAlignImage() {} centerAlignImage() {} rightAlignImage() {} applyFittingContentMode() {}
    applyFillingContentMode() {}
  }
  class Stack {
    addText(s) { return strict(new Txt(s), 'WidgetText'); }
    addDate(d) { return strict(new Txt(String(d)), 'WidgetDate'); }
    addImage() { drawn.push('[img]'); return strict(new Img(), 'WidgetImage'); }
    addSpacer(n) {} addStack() { return strict(new Stack(), 'WidgetStack'); }
    layoutHorizontally() {} layoutVertically() {}
    topAlignContent() {} centerAlignContent() {} bottomAlignContent() {}
    setPadding() {} useDefaultPadding() {}
    set backgroundColor(v) {} set backgroundImage(v) {} set backgroundGradient(v) {}
    set spacing(v) {} set size(v) {} set cornerRadius(v) {} set borderWidth(v) {}
    set borderColor(v) {} set url(v) {}
  }
  class ListWidget extends Stack {
    set refreshAfterDate(v) {} presentSmall() {} presentMedium() {} presentLarge() {}
    presentAccessoryRectangular() {} presentAccessoryInline() {} presentAccessoryCircular() {}
  }
  class Path {
    addRect() {} addRoundedRect() {} addEllipse() {} addLine() {} addLines() {}
    move() {} addCurve() {} addQuadCurve() {} closeSubpath() {}
  }
  class DrawContext {
    set size(v) {} set opaque(v) {} set respectScreenScale(v) {}
    setFillColor() {} setStrokeColor() {} setLineWidth() {} setFont() {} setTextColor() {}
    setTextAlignedLeft() {} setTextAlignedCenter() {} setTextAlignedRight() {}
    fillRect() {} fillEllipse() {} strokeRect() {} strokeEllipse() {}
    addPath() {} fillPath() {} strokePath() {}
    drawText() {} drawTextInRect() {} drawImageInRect() {} drawImageAtPoint() {}
    getImage() { return strict(new Img(), 'Image'); }
  }
  class Request {
    constructor(u) { this.url = u; this.response = { statusCode }; }
    set timeoutInterval(v) {} set method(v) {} set headers(v) {} set body(v) {}
    async loadString() { if (body instanceof Error) throw body; return body; }
    async loadJSON() { if (body instanceof Error) throw body; return JSON.parse(body); }
    async load() { return {}; } async loadImage() { return {}; }
  }

  const g = {
    drawn,
    ListWidget: new Proxy(ListWidget, { construct: () => strict(new ListWidget(), 'ListWidget') }),
    Path: new Proxy(Path, { construct: () => strict(new Path(), 'Path') }),
    DrawContext: new Proxy(DrawContext, { construct: () => strict(new DrawContext(), 'DrawContext') }),
    Request: new Proxy(Request, { construct: (T, a) => strict(new Request(...a), 'Request') }),
    Color: class { constructor(hex, alpha) { this.hex = hex; this.alpha = alpha; } },
    Font: strict({
      systemFont: () => ({}), boldSystemFont: () => ({}), mediumSystemFont: () => ({}),
      lightSystemFont: () => ({}), heavySystemFont: () => ({}),
      regularRoundedSystemFont: () => ({}), boldRoundedSystemFont: () => ({}),
      regularMonospacedSystemFont: () => ({})
    }, 'Font'),
    Size: class { constructor(w, h) { this.width = w; this.height = h; } },
    Rect: class { constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; } },
    Point: class { constructor(x, y) { this.x = x; this.y = y; } },
    DateFormatter: class {
      set dateFormat(v) { this._f = v; } set locale(v) {}
      useNoDateStyle() {} useShortTimeStyle() {}
      string(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
    },
    config: strict({ widgetFamily: family, runsInWidget: true, runsInApp: false, runsInActionExtension: false }, 'config'),
    Script: strict({ setWidget() {}, complete() {}, name: () => 'AJC Fitness' }, 'Script')
  };
  return g;
}

export async function runWidget(src, stubs) {
  const names = Object.keys(stubs);
  const fn = new Function(...names, `return (async () => { ${src} })();`);
  await fn(...names.map(n => stubs[n]));
  return stubs.drawn;
}
