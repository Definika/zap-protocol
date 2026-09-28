// Dev-only parity preview: runs the design prototype's own logic class (and its mock data module) against the converted
// components, mimicking the design runtime's host. Never imported in production builds (see App.tsx).

import { Component, createElement, type ReactNode } from 'react';
import * as React from 'react';
import logicSource from '../../../../design/extracted/logic.js?raw';
import keelDataUrl from '../../../../design/extracted/keel-data.js?url';
import { Root } from '../generated/Root';

const DEFAULT_PROPS = {
  theme: 'dark',
  accent: '#7B5CFA',
  density: 'compact',
  layout: 'Form right',
  orderForm: 'Dual buttons',
  device: 'auto',
  page: 'trade',
  connected: true,
  scenario: 'live',
  banner: 'none',
  demoToasts: false,
};

type Host = { __setLogicState(update: unknown, cb?: () => void): void; forceUpdate(): void };

class DCLogic {
  props: Record<string, unknown>;
  state: Record<string, unknown> = {};
  __host?: Host;
  constructor(props: Record<string, unknown>) {
    this.props = props || {};
  }
  setState(update: unknown, cb?: () => void) {
    this.__host?.__setLogicState(update, cb);
  }
  forceUpdate() {
    this.__host?.forceUpdate();
  }
  componentDidMount() {}
  componentDidUpdate(_prev: unknown) {}
  componentWillUnmount() {}
  renderVals(): Record<string, unknown> {
    return {};
  }
}

// The design runtime evaluates the logic source with these three names in scope.
const Logic = new Function('DCLogic', 'StreamableLogic', 'React', `${logicSource}\n;return Component;`)(
  DCLogic,
  DCLogic,
  React,
) as new (props: Record<string, unknown>) => DCLogic;

// Resources the logic resolves through window.__resources: its mock-data module and token logos.
const w = window as unknown as { __resources?: Record<string, string> };
w.__resources = new Proxy({ keelData: keelDataUrl } as Record<string, string>, {
  get: (t, k: string) => t[k] ?? (k.startsWith('L_logos_') ? `/logos/${k.slice(8).replace(/_(png|svg)$/, '.$1')}` : undefined),
});

export default class DesignPreview extends Component<Record<string, never>, { v: number }> {
  logic = new Logic(DEFAULT_PROPS);
  override state = { v: 0 };

  constructor(props: Record<string, never>) {
    super(props);
    this.logic.__host = {
      __setLogicState: (update, cb) => {
        const patch = typeof update === 'function' ? update(this.logic.state, this.logic.props) : update;
        if (patch) this.logic.state = { ...this.logic.state, ...(patch as object) };
        this.setState((s) => ({ v: s.v + 1 }), cb);
      },
      forceUpdate: () => this.forceUpdate(),
    };
  }

  override componentDidMount() {
    this.logic.componentDidMount();
  }

  override componentWillUnmount() {
    this.logic.componentWillUnmount();
  }

  override render(): ReactNode {
    return createElement(Root, { vm: { ...DEFAULT_PROPS, ...this.logic.renderVals() } });
  }
}
