/** Creates a native button for editor/plugin code that renders outside React. */
export function createButtonElement() {
  const button = document.createElement('button')
  button.type = 'button'
  return button
}
