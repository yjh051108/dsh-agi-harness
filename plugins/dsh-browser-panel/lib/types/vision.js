/**
 * Optional vision bridge: describe a live browser frame through an
 * OpenAI-compatible vision-language model (VLM). Purely opt-in — enabled only
 * when the plugin config provides a `vision` endpoint. The model remains
 * text-only by default; this tool is the explicit escape hatch the North Star
 * calls "optional VLM bridge" (screenshots selectively enter model context).
 *
 * Zero SDK dependency: speaks the standard Chat Completions wire format over
 * the built-in `fetch`.
 * @module @dsh-external/dsh-browser-panel/vision
 */
/** Render an error as a stable string without leaking credentials. */
function describeError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Capture the page as JPEG and ask the VLM to describe it.
 * @param page - the Playwright page to capture.
 * @param options - vision endpoint config.
 * @param prompt - instruction for the VLM.
 * @returns the model's text response.
 */
export async function describeFrame(page, options, prompt) {
    const shot = await page.screenshot({ type: 'jpeg', quality: 70 });
    const dataUrl = `data:image/jpeg;base64,${shot.toString('base64')}`;
    let response;
    try {
        response = await fetch(options.endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
            },
            body: JSON.stringify({
                model: options.model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: dataUrl } },
                        ],
                    },
                ],
                temperature: 0.2,
            }),
            signal: AbortSignal.timeout(30_000),
        });
    }
    catch (error) {
        throw new Error(`vision request failed: ${describeError(error)}`);
    }
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`vision endpoint returned ${response.status}: ${body.slice(0, 300)}`);
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content === '') {
        throw new Error('vision endpoint returned an empty response');
    }
    return content.trim();
}
