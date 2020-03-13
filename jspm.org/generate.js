import marked from 'marked';
import jsdom from 'jsdom';
import { promisify } from 'util';
import { readFile as _readFile, writeFile as _writeFile } from 'fs';
import mkdirp from 'mkdirp';
import path from 'path';
const readFile = promisify(_readFile), writeFile = promisify(_writeFile);
const { JSDOM } = jsdom;

const github = 'https://github.com/jspm/jspm.org/blob/master';
const templatePromise = readFile('./template.html');

async function generatePage (section, name, title, description, tocHtml, sitemap) {
  const source = (await readFile(section + '/' + name + '.md')).toString();
  const html = marked(source, { breaks: true, headerIds: false });

  const dom = new JSDOM((await templatePromise).toString());
  const document = dom.window.document;
  document.title = `${title} - jspm.org`;

  {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'twitter:card');
    meta.content = 'summary_large_image';
    document.head.insertBefore(meta, document.head.firstChild);
  }
  {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'og:url');
    meta.content = 'https://jspm.org/' + (section === 'pages' ? (name === 'index' ? '' : name) : section + '/' + name);
    document.head.insertBefore(meta, document.head.firstChild);
  }
  {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'og:description');
    meta.content = description;
    document.head.insertBefore(meta, document.head.firstChild);
  }
  {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'Description');
    meta.content = description;
    document.head.insertBefore(meta, document.head.firstChild);
  }
  {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'og:image');
    meta.content = 'https://jspm.org/jspm.png';
    document.head.insertBefore(meta, document.head.firstChild);
  }
  {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'og:title');
    meta.content = 'jspm.org - ' + title;
    document.head.insertBefore(meta, document.head.firstChild);
  }

  const body = document.body;
  body.className = `section-${section} page-${name}`;
  body.querySelector('.content').innerHTML = html;
  
  // Get all the primary headings
  const contents = [];
  const headings = body.querySelectorAll('.content h2');
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const slug = heading.textContent.replace(/\s/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-');
    const a = document.createElement('a');
    a.name = slug;
    a.className = 'anchor';
    contents.push({
      title: heading.textContent,
      slug
    });
    heading.parentNode.insertBefore(a, heading);
  }

  let prevSection, nextSection;
  
  const contentsWrapper = body.querySelector('.toc .sections');
  contentsWrapper.innerHTML = tocHtml + contentsWrapper.innerHTML;
  if (section !== 'pages') {
    const sectionContents = contentsWrapper.querySelector(`ul.section-${section} li.${name}`);
    const sectionNode = sectionContents.parentNode.parentNode;
    prevSection = sectionContents.previousSibling;
    nextSection = sectionContents.nextSibling;
    if (!prevSection) {
      prevSection = sectionNode.previousSibling;
    }
    if (!nextSection) {
      nextSection = sectionNode.nextSibling;
      while (nextSection && nextSection.nodeType !== 1)
        nextSection = nextSection.nextSibling;
      if (nextSection && !nextSection.querySelector('a').href)
        nextSection = null;
    }
    
    sectionNode.className += ' active';
    sectionContents.className += ' active';
    if (contents.length) {
      let sectionTocHtml = '<ul class="subsection">';
      for (const { title, slug } of contents) {
        sectionTocHtml += `<li><a href="#${slug}">${title}</a></li>`;
      }
      sectionTocHtml += '</ul>';
      sectionContents.innerHTML += sectionTocHtml;
    }
  }

  const nextprev = document.createElement('div');
  nextprev.className = 'nextprev';
  nextprev.innerHTML = `<a class="edit" target="_blank" href="${github}/${section}/${name}.md">Edit</a>`;
  body.querySelector('.content').appendChild(nextprev);

  if (nextSection) {
    nextprev.innerHTML += `<div class="next">${nextSection.querySelector('a').outerHTML}</div>`;
    nextprev.querySelector('.next a').innerHTML += '&nbsp;&#9654;';
  }
  if (prevSection) {
    nextprev.innerHTML += `<div class="prev">${prevSection.querySelector('a').outerHTML}</div>`;
    nextprev.querySelector('.prev a').innerHTML = '&#9664;&nbsp;' + nextprev.querySelector('.prev a').innerHTML;
  }
  
  // make all external links open in a new window
  body.querySelectorAll('a').forEach(x => {
    try { new URL(x.href) }
    catch { return }
    if (x.href.startsWith('about:blank'))
      return;
    x.target = '_blank';
  });
  
  // add rel=noopener to all target=blank links
  body.querySelectorAll('a[target]').forEach(x => x.rel = 'noopener');

  /* Super Lazy Syntax Highlighting */
  const langs = body.querySelectorAll('code');
  for (let i = 0; i < langs.length; i++) {
    const code = langs[i];
    code.innerHTML = code.innerHTML
      .replace(/^(\s*\/\/.*)/gm, '<span class=comment>$1</span>')
      .replace(/('[^']*')/gm, '<span class=string>$1</span>')
      .replace(/("[^"]*")/gm, '<span class=string>$1</span>')
      .replace(/([^#\d\-a-z\:])(-?\d+)/gm, '$1<span class=number>$2</span>')
      .replace(/([^\.])?(for|function|new|await|throw|return|var|let|const|if|else|true|false|this|import|export class|export|from)([^-a-zA-Z])/gm, '$1<span class=keyword>$2</span>$3');
  }
  
  // Extract the modified HTML
  const out = `./public_html/${section === 'pages' ? '' : section + '/'}${name}.html`;
  console.log('Writing ' + out);
  mkdirp.sync(path.dirname(out));
  await writeFile(out, dom.serialize());
}

async function generateSection (section, sitemap, tocHtml) {
  const generations = [];
  for (const [name, { title, description }] of Object.entries(sitemap[section].index)) {
    generations.push(generatePage(section, name, title, description, tocHtml, sitemap));
  }
  await Promise.all(generations);
}

function generateToc (sitemap) {
  let tocHtml = ``;
  const sections = Object.keys(sitemap).filter(name => sitemap[name].title);
  for (const section of sections) {
    const { title, index } = sitemap[section];

    // section title links to first page of section
    tocHtml += `<li class="${section}"><a href="/${section}/${Object.keys(index)[0]}">${title}</a>`;
    tocHtml += `<ul class="section-${section}">`;
    for (const [name, { title }] of Object.entries(index)) {
      tocHtml += `<li class="${name}"><a href="/${section}/${name}">${title}</a></li>`;
    }
    tocHtml += `</ul></li>`;
  }
  return tocHtml;
}

Promise.resolve()
.then(async () => {
  const sitemap = JSON.parse(await readFile('./sitemap.json'));
  const tocHtml = generateToc(sitemap);

  await Promise.all(
    Object.keys(sitemap).map(name => generateSection(name, sitemap, tocHtml))
  );
})
.then(() => {
  console.log('Completed.');
}, err => {
  console.error(err);
});