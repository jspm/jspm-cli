// The idea is to try and trick the CLI thinking that this is a HTML file with
// an inline module. We should be able to handle this kind of thing:
const inlineHtmlString = `
<!DOCTYPE>
<html>
	<head>
		<title>Inline Modules</title>
	</head>
	<body>
		<h1>Test</h1>
	</body>
	<script type="module">
		import * from './a.js';
	</script>
</html>
`

console.log(inlineHtmlString);
