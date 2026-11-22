---
layout: default
title: home
permalink: /
---

<div class="banner" style="margin:0 0 1.2em">
  <img id="banner-img" src="{{ '/assets/legacy/rotate/100207_meander_oi_950x230.jpg' | relative_url }}" alt="" style="width:100%;height:auto;display:block">
</div>
<script>
(function () {
  var imgs = [
    "{{ '/assets/legacy/rotate/100207_meander_oi_950x230.jpg' | relative_url }}",
    "{{ '/assets/legacy/rotate/111128_aneyoshi_950x230.jpg' | relative_url }}",
    "{{ '/assets/legacy/rotate/08032627_niagara_950x230.jpg' | relative_url }}"
  ];
  var el = document.getElementById('banner-img'), i = Math.floor(Math.random() * imgs.length);
  el.src = imgs[i];
  setInterval(function () { i = (i + 1) % imgs.length; el.src = imgs[i]; }, 6000);
})();
</script>

## research interests

Geomorphology, Geoarchaeology and Geospatial Information Analysis &ndash; various fields of study in physical geography, geosciences and geospatial information science (GIS) are of my research interest.

<span class="ja">地形学、地考古学、空間情報解析を中心に、自然地理学や地球科学、空間情報科学に関するさまざまな研究を行っています。</span>

[more &raquo;]({{ '/research/' | relative_url }})

## updates

- Research blog: [hdtopography.blogspot.com](http://hdtopography.blogspot.com/)

## links

- [Environmental Geography / 環境地理学分野](https://envgeo.ees.hokudai.ac.jp/)
- [Faculty of Environmental Earth Science / 地球環境科学研究院](https://www.ees.hokudai.ac.jp/index.php?easiestml_lang=en)
- [Hokkaido University / 北海道大学](https://www.global.hokudai.ac.jp/)
- [Geomorphology (Elsevier)](https://www.sciencedirect.com/journal/geomorphology)
- CV (PDF, 2017-01): [CV_hayakawa_170123.pdf]({{ '/assets/files/CV_hayakawa_170123.pdf' | relative_url }})

## contact

060-0810 札幌市北区北10条西5丁目 北海道大学 地球環境科学研究院<br>
N10W5 Kita-ku, Sapporo, Hokkaido 060-0810, Japan<br>
[address, map and contact form &raquo;]({{ '/contact/' | relative_url }})
