// Hosts the terminal's view logic (a design-runtime logic class) as a React component and renders the converted design
// with its values, plus ZAP's own overlays (enable trading, funds).

import { Component, type ReactNode } from 'react';
import { Root } from '../design/generated/Root';
import type { Zap } from '../wallet/types';
import { TerminalLogic } from './logic';
import { EnableTradingModal, FundsModal } from './Onboarding';

/** The design's presentation settings (its tweakable props), fixed to the shipped look. */
const LOOK = {
  theme: 'dark',
  accent: '#7B5CFA',
  density: 'compact',
  layout: 'Form right',
  orderForm: 'Dual buttons',
  device: 'auto',
  page: 'trade',
};

export class Terminal extends Component<{ zap: Zap }, { v: number }> {
  logic = new TerminalLogic({ ...LOOK, zap: this.props.zap });
  override state = { v: 0 };
  private prevLogicProps = this.logic.props;

  constructor(props: { zap: Zap }) {
    super(props);
    this.logic.__host = {
      __setLogicState: (update, cb) => {
        const patch = typeof update === 'function' ? (update as (s: unknown, p: unknown) => unknown)(this.logic.state, this.logic.props) : update;
        if (patch) this.logic.state = { ...this.logic.state, ...(patch as object) };
        this.setState((s) => ({ v: s.v + 1 }), cb);
      },
      forceUpdate: () => this.forceUpdate(),
    };
  }

  override componentDidMount() {
    this.logic.componentDidMount();
  }

  override componentDidUpdate() {
    if (this.prevLogicProps !== this.logic.props) {
      const prev = this.prevLogicProps;
      this.prevLogicProps = this.logic.props;
      this.logic.componentDidUpdate(prev);
    }
  }

  override componentWillUnmount() {
    this.logic.componentWillUnmount();
  }

  override render(): ReactNode {
    if ((this.logic.props as { zap?: Zap }).zap !== this.props.zap) this.logic.props = { ...LOOK, zap: this.props.zap };
    return (
      <Root vm={{ ...LOOK, ...this.logic.renderVals() }}>
        <EnableTradingModal />
        <FundsModal />
      </Root>
    );
  }
}
