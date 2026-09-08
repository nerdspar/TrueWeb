<script lang="ts">
	/**
	 * The compose editor (§5.2). A plain textarea, deliberately:
	 *  - autocorrect/autocapitalize/spellcheck/autocomplete all off, because iOS
	 *    autocorrect silently mangles image tags and env values;
	 *  - wrap="off" plus horizontal scroll, so indentation stays readable
	 *    instead of soft-wrapping into nonsense;
	 *  - Enter carries the current line's indentation, which a bare textarea
	 *    does not do and which makes editing YAML on a phone bearable;
	 *  - Tab inserts two spaces (YAML forbids tab indentation) and Shift+Tab
	 *    outdents.
	 */
	let {
		value = $bindable(''),
		placeholder = '',
		rows = 16,
		onpasted
	}: {
		value?: string;
		placeholder?: string;
		rows?: number;
		onpasted?: () => void;
	} = $props();

	let el = $state<HTMLTextAreaElement | null>(null);

	/** Replace a range and put the caret back, keeping the binding in step. */
	function splice(start: number, end: number, insert: string, caret: number) {
		if (!el) return;
		el.value = el.value.slice(0, start) + insert + el.value.slice(end);
		el.selectionStart = el.selectionEnd = caret;
		value = el.value;
	}

	function onkeydown(event: KeyboardEvent) {
		if (!el) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;

		if (event.key === 'Enter') {
			const lineStart = el.value.lastIndexOf('\n', start - 1) + 1;
			const indent = (el.value.slice(lineStart, start).match(/^[ ]*/) ?? [''])[0];
			event.preventDefault();
			splice(start, end, `\n${indent}`, start + 1 + indent.length);
			return;
		}

		if (event.key === 'Tab') {
			event.preventDefault();
			if (event.shiftKey) {
				const lineStart = el.value.lastIndexOf('\n', start - 1) + 1;
				const lead = (el.value.slice(lineStart, start).match(/^[ ]*/) ?? [''])[0];
				const remove = Math.min(2, lead.length);
				if (remove > 0) splice(lineStart, lineStart + remove, '', start - remove);
			} else {
				splice(start, end, '  ', start + 2);
			}
		}
	}

	function onpaste() {
		// Let the paste land, then hand back so the whole document can be
		// sanitised in one pass (§5.2: sanitise on paste, before validation).
		setTimeout(() => onpasted?.(), 0);
	}
</script>

<textarea
	bind:this={el}
	bind:value
	{placeholder}
	{rows}
	{onkeydown}
	{onpaste}
	wrap="off"
	spellcheck="false"
	autocapitalize="off"
	autocorrect="off"
	autocomplete="off"
	aria-label="docker-compose YAML"
></textarea>

<style>
	textarea {
		display: block;
		width: 100%;
		resize: vertical;
		background: #04050a;
		color: #cfd6e6;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 10px 12px;
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.55;
		tab-size: 2;
		/* No soft wrap: horizontal scroll instead, so indentation is truthful. */
		white-space: pre;
		overflow-x: auto;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}
	textarea:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
</style>
