// Executes every tool_use block of one assistant turn and returns the
// matching tool_result blocks, streaming side events (live output, images,
// pending notifications) to the run's SSE clients along the way. Shared by
// the classic and correction run loops.
async function collectToolResults({ content, executeTool, ctx, pushEvent }) {
	const toolResults = [];
	for (const block of content) {
		if (block.type !== "tool_use") continue;
		const result = await executeTool(block.name, block.input, {
			...ctx,
			onToolOutput: (text) => pushEvent({ type: "tool_output", tool_use_id: block.id, text }),
		});
		let resultContent;
		if (result?._isImage) {
			resultContent = [{ type: "image", source: { type: "base64", media_type: result.media_type, data: result.data } }];
			// Claude sees every image result via the API response, but the human
			// only sees a tool pill unless we also stream the image itself.
			pushEvent({ type: "tool_image", tool_use_id: block.id, media_type: result.media_type, data: result.data });
		} else if (result?._isPending) {
			pushEvent({ type: "pending", testname: result.testname });
			resultContent = result.message;
		} else {
			resultContent = String(result);
		}
		toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultContent });
		// The human only ever saw a tool-name pill live — the actual result
		// text (already redacted inside the tool, same as what Claude itself
		// receives) goes out too, so the UI can show a console dump / line
		// count / matched lines instead of just "a tool ran".
		if (typeof resultContent === "string") {
			pushEvent({ type: "tool_result", tool_use_id: block.id, content: resultContent });
		}
	}
	return toolResults;
}

module.exports = { collectToolResults };
