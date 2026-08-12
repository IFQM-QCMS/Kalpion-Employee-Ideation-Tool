# -*- coding: utf-8 -*-
"""
Read the real API surface out of the route files.

The API section of the architecture document used to be written by hand, which
meant its endpoint counts were true on the day somebody typed them and drifted
every week afterwards. This reads the routes instead, so the document can be
built from what the code actually exposes.

    python docs/api_inventory.py            # print the inventory

Returns, per group: the mount path, every method and path, the guard on it, and
the controller it calls.
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTES = os.path.join(ROOT, 'backend', 'src', 'routes')

ROUTE_RE = re.compile(
    r"^router\.(get|post|put|patch|delete)\(\s*'([^']*)'\s*,?\s*(.*?)\)\s*;",
    re.M)
MOUNT_RE = re.compile(r"router\.use\('(/[a-z-]+)',\s*(\w+)")
USE_GUARD_RE = re.compile(r"^router\.use\((\w+)\)", re.M)


def guard_of(rest, consts):
    """
    The auth guard on a route line, in plain words.

    `consts` carries the guard and role constants declared at the top of the
    same file. Resolving them matters: an earlier version of this reported eight
    admin-only routes as "public" because they were guarded by a named constant
    (`const ADMIN = requireRole(...)`) rather than by an inline call. A document
    that claims bulk user import is unauthenticated is worse than no document.
    """
    # A named constant standing in for a guard, e.g. `ADMIN`.
    for name, value in consts.items():
        if re.search(r'\b%s\b' % re.escape(name), rest) and 'requireRole' in value:
            roles = re.findall(r"'([a-z_]+)'", value)
            if roles:
                return 'roles: ' + ', '.join(roles)

    if 'requirePlatformAuth' in rest:
        return 'IFQM platform staff'

    m = re.search(r'requireRole\(([^)]*)\)', rest)
    if m:
        inner = m.group(1)
        roles = re.findall(r"'([a-z_]+)'", inner)
        # `requireRole(...REVIEWER_ROLES)` — expand the list it spreads.
        for spread in re.findall(r'\.\.\.(\w+)', inner):
            roles += re.findall(r"'([a-z_]+)'", consts.get(spread, ''))
        if roles:
            seen = []
            for r in roles:
                if r not in seen:
                    seen.append(r)
            return 'roles: ' + ', '.join(seen)
        return 'roles'

    if 'requireAuth' in rest:
        return 'any signed-in user'
    if 'optionalAuth' in rest:
        return 'optional'
    return ''


def controller_of(rest):
    m = re.search(r'\b(\w+)\.(\w+)\s*\)?\s*$', rest.strip().rstrip(');'))
    if m:
        return '%s.%s' % (m.group(1), m.group(2))
    m = re.search(r'\b(\w+\.\w+)\b', rest)
    return m.group(1) if m else ''


def inventory():
    index = io.open(os.path.join(ROUTES, 'index.js'), encoding='utf-8').read()
    mounts = {}
    for path, var in MOUNT_RE.findall(index):
        mounts[var] = path

    imports = dict(re.findall(r"import\s+(\w+)\s+from\s+'\./(\w+)\.js'", index))

    groups = []
    for var, mount in mounts.items():
        filename = imports.get(var, var)
        path = os.path.join(ROUTES, filename + '.js')
        if not os.path.exists(path):
            continue
        src = io.open(path, encoding='utf-8').read()

        # Constants declared at the top of the route file: guards and role lists.
        consts = dict(re.findall(r"^const\s+([A-Z][A-Z_0-9]*)\s*=\s*(.+?);\s*$",
                                 src, re.M))

        # A guard applied to the whole router covers every route in the file.
        blanket = ''
        for g in USE_GUARD_RE.findall(src):
            if 'Platform' in g:
                blanket = 'IFQM platform staff'
            elif 'Auth' in g:
                blanket = 'any signed-in user'

        routes = []
        for method, sub, rest in ROUTE_RE.findall(src):
            full = mount + ('' if sub == '/' else sub)
            routes.append({
                'method': method.upper(),
                'path': '/api' + full,
                'guard': guard_of(rest, consts) or blanket or 'none — public',
                'controller': controller_of(rest),
            })
        groups.append({'mount': '/api' + mount, 'file': filename + '.js',
                       'blanket': blanket, 'routes': routes})

    groups.sort(key=lambda g: -len(g['routes']))
    return groups


def totals(groups):
    return sum(len(g['routes']) for g in groups), len(groups)


if __name__ == '__main__':
    gs = inventory()
    n, ngroups = totals(gs)
    print('%d endpoints across %d route groups\n' % (n, ngroups))
    for g in gs:
        print('%-22s %2d  (%s)' % (g['mount'], len(g['routes']), g['file']))
    print('\n── every endpoint ──')
    for g in gs:
        for r in g['routes']:
            print('  %-6s %-42s %-26s %s'
                  % (r['method'], r['path'], r['guard'], r['controller']))
