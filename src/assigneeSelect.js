/**
 * Populate an assignee <select> treating member names as plain text.
 * Uses DOM APIs + textContent so HTML in names is never parsed.
 *
 * @param {HTMLSelectElement} select
 * @param {Array<{ id: string, name: string }>} members
 * @param {string} [selected]
 */
export function populateAssigneeSelect(select, members, selected = "") {
  if (!select) return;

  select.replaceChildren();

  const unassigned = select.ownerDocument.createElement("option");
  unassigned.value = "";
  unassigned.textContent = "Unassigned";
  select.appendChild(unassigned);

  for (const member of members) {
    const option = select.ownerDocument.createElement("option");
    option.value = member.id;
    option.textContent = member.name;
    select.appendChild(option);
  }

  select.value = selected ?? "";
}
