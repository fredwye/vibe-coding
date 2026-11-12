---
name: pages-legales
description: Ajoute à un site HTML statique un pied de page commun et les pages aide, info site, accessibilité, données personnelles et mentions légales, sans inventer d'information légale. À utiliser sur un site statique (Cloudflare Pages) qui n'a pas encore ces pages.
---

# Pages légales pour un site statique

Demande d'abord les deux variables si elles manquent :
- PROJET : nom du projet
- ORGANISME : nom de l'organisme affiché dans le pied de page

Travaille sur une nouvelle branche.

## Étapes

1. Ajoute un pied de page identique sur toutes les pages : `<footer>` contenant `<nav aria-label="Pied de page">` avec les liens Aide, Info site, « Accessibilité : non conforme », Site de {ORGANISME}, Cookies / Données personnelles, Mentions légales.
2. Crée `aide.html`, `info-site.html`, `accessibilite.html`, `donnees-personnelles.html` et `mentions-legales.html`, avec le même gabarit (feuille de style commune `pages.css`, lien d'évitement, repères header / main / footer).
3. Respecte les règles d'accessibilité : https://github.com/etalab-ia/skills
4. Respecte les règles d'éco-conception : https://github.com/Institut-du-Numerique-Responsable/green-claude

## Contraintes

- N'invente aucune information légale : écris `[À COMPLÉTER]` à la place (éditeur, hébergeur, durée de conservation, traceurs, contact).
- N'ajoute aucun traceur ni secret côté navigateur : pas de script tiers, pas de police externe, pas d'image inutile.
- Ne mets aucune information personnelle dans les pages ni dans ce skill.
- Termine par la liste des domaines tiers chargés par les pages (CSS, scripts, polices, images, iframes). Les simples liens sortants ne comptent pas.
