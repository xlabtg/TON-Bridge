customElements.define('ion-icon', class extends HTMLElement {
    connectedCallback() {
        const name = this.getAttribute('name');
        if (!name) return;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.cssText = 'display:inline-block;width:1em;height:1em;fill:currentColor;stroke:currentColor;vertical-align:-0.125em';
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', 'assets/img/icons.svg#' + name);
        svg.appendChild(use);
        this.appendChild(svg);
    }
});
