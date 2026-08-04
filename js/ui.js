// Puts a submit button into a spinner+disabled state during an async action,
// and always restores it afterward (even on error) via the finally block.
function withButtonLoading(button, labelWhileLoading, fn) {
  const originalHTML = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="btn-spinner"></span> ${labelWhileLoading}`;

  return Promise.resolve(fn()).finally(() => {
    button.disabled = false;
    button.innerHTML = originalHTML;
  });
}
