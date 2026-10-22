import assert from "node:assert/strict";
import test from "node:test";
import { populateAssigneeSelect } from "../src/assigneeSelect.js";

/** Minimal select/document stand-in — enough to exercise textContent (not innerHTML). */
function createSelectHarness() {
  const childNodes = [];
  const ownerDocument = {
    createElement(tagName) {
      assert.equal(tagName, "option");
      return {
        tagName: "OPTION",
        value: "",
        textContent: "",
        /** Detect accidental HTML sinks during the test. */
        set innerHTML(_value) {
          throw new Error("innerHTML must not be used for assignee options");
        },
        get innerHTML() {
          return this.textContent;
        },
      };
    },
  };

  return {
    select: {
      ownerDocument,
      value: "",
      childNodes,
      replaceChildren(...nodes) {
        childNodes.length = 0;
        childNodes.push(...nodes);
      },
      appendChild(node) {
        childNodes.push(node);
        return node;
      },
    },
    options: childNodes,
  };
}

test("member names containing HTML characters remain literal text", () => {
  const { select, options } = createSelectHarness();
  const hostileName = `<img src=x onerror=alert(1)>`;
  const breakoutName = `</option></select><img src=x onerror=alert(1)>`;

  populateAssigneeSelect(
    select,
    [
      { id: "u1", name: hostileName },
      { id: 'u"2', name: breakoutName },
      { id: "u3", name: `Tom & Jerry <script>` },
    ],
    "u1",
  );

  assert.equal(options.length, 4);
  assert.equal(options[0].value, "");
  assert.equal(options[0].textContent, "Unassigned");

  assert.equal(options[1].value, "u1");
  assert.equal(options[1].textContent, hostileName);
  assert.equal(options[1].textContent.includes("<img"), true);

  assert.equal(options[2].value, 'u"2');
  assert.equal(options[2].textContent, breakoutName);

  assert.equal(options[3].value, "u3");
  assert.equal(options[3].textContent, "Tom & Jerry <script>");

  assert.equal(select.value, "u1");

  // No option was built by concatenating HTML; labels are plain textContent only.
  for (const option of options) {
    assert.equal(typeof option.textContent, "string");
    assert.equal(option.childNodes, undefined);
  }
});

test("empty member list still provides Unassigned", () => {
  const { select, options } = createSelectHarness();
  populateAssigneeSelect(select, [], "");
  assert.equal(options.length, 1);
  assert.equal(options[0].textContent, "Unassigned");
  assert.equal(select.value, "");
});
