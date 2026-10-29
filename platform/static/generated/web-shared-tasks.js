var PyCloudTasks = (function(exports) {
  "use strict";
  const SET_RE = /\{[^{}]*\}/g;
  function collapse(s) {
    return s.trim().replace(/\s+/g, " ");
  }
  function looseLineEq(exp, got) {
    const eSets = exp.match(SET_RE) || [];
    const gSets = got.match(SET_RE) || [];
    if (!eSets.length || eSets.length !== gSets.length) {
      return collapse(exp) === collapse(got);
    }
    if (collapse(exp.replace(SET_RE, "\0")) !== collapse(got.replace(SET_RE, "\0"))) {
      return false;
    }
    const items = (s) => s.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean).sort();
    return eSets.every((es, i) => {
      const a = items(es);
      const b = items(gSets[i]);
      return a.length === b.length && a.every((v, j) => v === b[j]);
    });
  }
  function splitLines(s) {
    const arr = String(s ?? "").replace(/\r/g, "").split("\n");
    while (arr.length && !arr[arr.length - 1].trim()) arr.pop();
    while (arr.length && !arr[0].trim()) arr.shift();
    return arr;
  }
  function outputsEqual(expected, got) {
    const e = splitLines(expected);
    const g = splitLines(got);
    return e.length === g.length && e.every((line, i) => looseLineEq(line, g[i]));
  }
  function referenceProgram(task) {
    const m = task.code && task.code.match(/^([ \t]*)# TODO: допишите код здесь[ \t]*$/m);
    if (task.type === "дописать код" && m) {
      const indent = m[1];
      const frag = task.answer.split("\n").map((l) => l ? indent + l : l).join("\n");
      return task.code.replace(m[0], frag);
    }
    if (task.type === "исправить ошибку" || task.type === "дописать код") {
      return task.answer;
    }
    return null;
  }
  exports.collapse = collapse;
  exports.looseLineEq = looseLineEq;
  exports.outputsEqual = outputsEqual;
  exports.referenceProgram = referenceProgram;
  exports.splitLines = splitLines;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
})({});
