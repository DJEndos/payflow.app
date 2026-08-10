// Puts a submit button into a spinner+disabled state during an async action,
// and always restores it afterward (even on error) via the finally block.
// Also catches anything that throws (network failure, CORS block, a non-JSON
// response) so a broken request shows an error instead of silently doing nothing.
function withButtonLoading(button, labelWhileLoading, fn, onError) {
  const originalHTML = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="btn-spinner"></span> ${labelWhileLoading}`;

  return Promise.resolve()
    .then(fn)
    .catch((err) => {
      console.error(err);
      if (onError) {
        onError(err);
      } else {
        alert("Something went wrong reaching the server. Check your connection and try again.");
      }
    })
    .finally(() => {
      button.disabled = false;
      button.innerHTML = originalHTML;
    });
}
