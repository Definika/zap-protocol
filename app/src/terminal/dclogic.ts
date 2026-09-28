// Base class for the terminal's view logic, with the same small surface the design runtime gave its components:
// state held on the logic object, setState/forceUpdate forwarded to the React host, and lifecycle hooks.

export interface LogicHost {
  __setLogicState(update: unknown, cb?: () => void): void;
  forceUpdate(): void;
}

export class DCLogic<P = Record<string, unknown>> {
  props: P;
  state: Record<string, any> = {};
  __host?: LogicHost;

  constructor(props: P) {
    this.props = props;
  }

  setState(update: unknown, cb?: () => void) {
    this.__host?.__setLogicState(update, cb);
  }

  forceUpdate() {
    this.__host?.forceUpdate();
  }

  componentDidMount() {}
  componentDidUpdate(_prev: P) {}
  componentWillUnmount() {}
  renderVals(): Record<string, unknown> {
    return {};
  }
}
