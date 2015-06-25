
import EventEmitter from 'events'
import {Map, Set, List} from 'immutable'

import dirToDest from './dir-to-dest';

var keyCodes = {
  72: 'left',  // 'h',
  74: 'down',  // 'j',
  75: 'up',    // 'k',
  76: 'right', // 'l',

  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
}

class Store extends EventEmitter {
  constructor(bridge) {
    super()
    this.data = new Map();
    this.roots = new List();
    this.parents = new window.Map();
    this.bridge = bridge;
    this.hovered = null;
    this.selected = null;
    this.selBottom = false;
    this.searchText = '';
    this.bridge.on('root', id => {
      if (this.roots.contains(id)) {
        return;
      }
      this.roots = this.roots.push(id);
      if (!this.selected) {
        this.selected = id;
        this.emit('selected');
        this.bridge.send('selected', id);
      }
      this.emit('roots');
    });
    window.store = this;

    this.bridge.on('select', id => {
      var node = this.get(id);
      var pid = this.parents.get(id);
      while (pid) {
        node = this.get(pid);
        if (node.get('collapsed')) {
          this.toggleCollapse(pid);
        }
        pid = this.parents.get(pid);
      }
      this.selectTop(this.skipWrapper(id));
    });

    this.bridge.on('mount', (data) => this.mountComponent(data));
    this.bridge.on('update', (data) => this.updateComponent(data));
    this.bridge.on('unmount', id => this.unmountComponenent(id));
  }

  onChangeSearch(text) {
    var needle = text.toLowerCase();
    if (needle === this.searchText.toLowerCase()) {
      return;
    }
    if (!text) {
      this.searchRoots = null;
    } else {
      var base;
      // TODO: this could be sped up by forming an index ahead of time of
      // elements w/ the same name. ... but we'll wait to complicate things
      // until there are perf reasons.
      if (this.searchRoots && needle.indexOf(this.searchText.toLowerCase()) === 0) {
        this.searchRoots = this.searchRoots
          .filter(item => this.get(item).get('name').toLowerCase().indexOf(needle) !== -1);
      } else {
        this.searchRoots = this.data.entrySeq()
          .filter(([key, val]) => (
            val.get('name') &&
            val.get('nodeType') !== 'Wrapper' &&
            val.get('name').toLowerCase().indexOf(needle) !== -1
          ))
          .map(([key, val]) => key);
      }
      this.searchRoots.forEach(id => {
        if (this.hasBottom(id)) {
          this.data = this.data.setIn([id, 'collapsed'], true);
        }
      });
    }
    this.searchText = text;
    this.emit('searchText');
    this.emit('searchRoots');
    if (this.searchRoots && !this.searchRoots.contains(this.selected)) {
      this.select(null, true);
      // this.select(this.searchRoots.get(0), true);
    } else if (!this.searchRoots) {
      this.revealDeep(this.selected);
    }
  }

  showContextMenu(type, evt, ...args) {
    evt.preventDefault();
    console.log('menu', type, args);
    this.contextMenu = {type, x: evt.pageX, y: evt.pageY, args};
    this.emit('contextMenu');
  }

  hideContextMenu() {
    this.contextMenu = null;
    this.emit('contextMenu');
  }

  selectFirstNode() {
    this.select(this.searchRoots.get(0), true);
  }

  revealDeep(id) {
    var pid = this.parents.get(id);
    while (pid) {
      if (this.data.getIn([pid, 'collapsed'])) {
        this.data = this.data.setIn([pid, 'collapsed'], false);
        this.emit(pid);
      }
      pid = this.parents.get(pid);
    }
  }

  onKeyDown(e) {
    if (window.document.activeElement !== document.body) {
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    var direction = keyCodes[e.keyCode];
    if (!direction) {
      return;
    }
    e.preventDefault();
    var dest = this.getDest(direction);
    if (!dest) {
      return;
    }
    var move = this.getNewSelection(dest);
    if (move && move !== this.selected) {
      this.select(move);
    }
  }

  skipWrapper(id, up) {
    if (!id) {
      return;
    }
    var node = this.get(id);
    if (node.get('nodeType') !== 'Wrapper') {
      return id;
    }
    if (up) {
      return this.parents.get(id);
    }
    return node.get('children')[0];
  }

  hasBottom(id) {
    var node = this.get(id);
    var children = node.get('children');
    if ('string' === typeof children || !children || !children.length || node.get('collapsed')) {
      return false;
    }
    return true;
  }

  getDest(dir) {
    var id = this.selected;
    var bottom = this.selBottom;
    var node = this.get(id);
    var collapsed = node.get('collapsed');
    var children = node.get('children');
    var hasChildren = children && 'string' !== typeof children && children.length;
    var pid = this.parents.get(id);

    if (this.searchRoots && this.searchRoots.contains(id)) {
      pid = null;
    }

    return dirToDest(dir, bottom, collapsed, hasChildren);
  }

  getNewSelection(dest) {
    var id = this.selected;
    var bottom = this.selBottom;
    var node = this.get(id);
    var pid = this.skipWrapper(this.parents.get(id), true);

    if (this.searchRoots && this.searchRoots.contains(id)) {
      pid = null;
    }

    if (dest === 'parent') {
      return pid;
    }
    if (dest === 'parentBottom') {
      this.selBottom = true;
      return pid;
    }

    if (dest === 'collapse') {
      this.toggleCollapse(id);
      return;
    }
    if (dest === 'uncollapse') {
      this.toggleCollapse(id);
      return;
    }

    if (dest === 'bottom') {
      this.selBottom = true;
      this.emit(this.selected);
      return;
    }
    if (dest === 'top') {
      this.selBottom = false;
      this.emit(this.selected);
      return;
    }

    if (dest === 'firstChild') {
      var children = node.get('children')
      if ('string' === typeof children) {
        return this.getNewSelection('nextSibling');
      }
      this.selBottom = false;
      return this.skipWrapper(children[0]);
    }
    if (dest === 'lastChild') {
      var children = node.get('children');
      if ('string' === typeof children) {
        return this.getNewSelection('prevSibling');
      }
      var cid = this.skipWrapper(children[children.length - 1]);
      if (!this.hasBottom(cid)) {
        this.selBottom = false;
      }
      return cid;
    }

    if (!pid) {
      var roots = this.searchRoots || this.roots;
      var ix = roots.indexOf(id);
      if (ix === -1) {
        ix = roots.indexOf(this.parents.get(id));
      }
      if (dest === 'prevSibling') { // prev root
        if (ix === 0) {
          return null;
        }
        var prev = this.skipWrapper(roots.get(ix - 1));
        this.selBottom = this.hasBottom(prev);
        return prev;
      } else if (dest === 'nextSibling') {
        if (ix >= roots.size - 1) {
          return null;
        }
        this.selBottom = false;
        return this.skipWrapper(roots.get(ix + 1));
      }
      return null;
    }

    var parent = this.get(pid);
    var pchildren = parent.get('children');
    var pix = pchildren.indexOf(id);
    if (pix === -1) {
      pix = pchildren.indexOf(this.parents.get(id));
    }
    if (dest === 'prevSibling') {
      if (pix === 0) {
        return this.getNewSelection('parent');
      }
      var cid = this.skipWrapper(pchildren[pix - 1]);
      if (this.hasBottom(cid)) {
        this.selBottom = true;
      }
      return cid;
    }
    if (dest === 'nextSibling') {
      if (pix === pchildren.length - 1) {
        return this.getNewSelection('parentBottom');
      }
      this.selBottom = false;
      return this.skipWrapper(pchildren[pix + 1]);
    }
    return null;
  }

  get(id) {
    return this.data.get(id);
  }

  off(evt, fn) {
    this.removeListener(evt, fn);
  }

  toggleCollapse(id) {
    this.data = this.data.updateIn([id, 'collapsed'], c => !c);
    this.emit(id);
  }

  setProps(id, path, value) {
    this.bridge.send('setProps', {id, path, value});
  }

  setState(id, path, value) {
    this.bridge.send('setState', {id, path, value});
  }

  setContext(id, path, value) {
    this.bridge.send('setContext', {id, path, value});
  }

  inspect(id, path, cb) {
    this.bridge.inspect(id, path, cb)
  }

  makeGlobal(id, path) {
    this.bridge.send('makeGlobal', {id, path});
  }

  setHover(id, isHovered) {
    if (isHovered) {
      var old = this.hovered;
      this.hovered = id;
      if (old) {
        this.emit(old);
      }
      this.emit(id);
      this.emit('hover');
      this.bridge.send('highlight', id);
    } else if (this.hovered === id) {
      this.hovered = null;
      this.emit(id);
      this.emit('hover');
      this.bridge.send('hideHighlight');
    }
  }

  selectBottom(id) {
    this.selBottom = true;
    this.select(id);
  }

  selectTop(id) {
    this.selBottom = false;
    this.select(id);
  }

  select(id, noHighlight) {
    var oldSel = this.selected;
    this.selected = id;
    if (oldSel) {
      this.emit(oldSel);
    }
    if (id) {
      this.emit(id);
    }
    this.emit('selected');
    this.bridge.send('selected', id);
    if (!noHighlight) {
      this.bridge.send('highlight', id);
    }
  }

  mountComponent(data) {
    var map = Map(data).set('renders', 1);
    if (data.nodeType === 'Custom') {
      map = map.set('collapsed', true);
    }
    this.data = this.data.set(data.id, map);
    if (data.children && data.children.forEach) {
      data.children.forEach(cid => {
        this.parents.set(cid, data.id);
      });
    }
    this.emit(data.id);
  }

  updateComponent(data) {
    var node = this.get(data.id)
    if (!node) {
      return;
    }
    data.renders = node.get('renders') + 1;
    this.data = this.data.mergeIn([data.id], Map(data));
    if (data.children && data.children.forEach) {
      data.children.forEach(cid => {
        this.parents.set(cid, data.id);
      });
    }
    this.emit(data.id);
  }

  unmountComponenent(id) {
    var pid = this.parents.get(id);
    this.parents.delete(id);
    this.data = this.data.delete(id)
    if (pid) {
      this.emit(pid);
    } else {
      var ix = this.roots.indexOf(id);
      if (ix !== -1) {
        this.roots = this.roots.delete(ix);
        this.emit('roots');
      }
    }
  }

}

module.exports = Store;
