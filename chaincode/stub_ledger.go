package consentaccess

import "github.com/hyperledger/fabric-chaincode-go/v2/shim"

// stubLedger adapts Fabric's shim.ChaincodeStubInterface to the Ledger
// interface, so the functions in chaincode.go run unchanged against the
// peer's world state once deployed — the same functions MockLedger backs
// in the unit tests.
//
// Ledger's methods do not return errors (MockLedger cannot fail), but the
// stub's can. stubLedger therefore records the first error it sees in err,
// and SmartContract checks it after every call and fails the transaction.
// Because Fabric only commits a transaction's writes if the transaction
// function returns successfully, a failed stub call can never leave a
// partial update on the ledger.
type stubLedger struct {
	stub shim.ChaincodeStubInterface
	err  error
}

func newStubLedger(stub shim.ChaincodeStubInterface) *stubLedger {
	return &stubLedger{stub: stub}
}

func (l *stubLedger) record(err error) {
	if err != nil && l.err == nil {
		l.err = err
	}
}

// GetState reports a key as present only if it holds a non-nil value; the
// stub returns nil for keys that were never written or have been deleted.
func (l *stubLedger) GetState(key string) ([]byte, bool) {
	v, err := l.stub.GetState(key)
	if err != nil {
		l.record(err)
		return nil, false
	}
	return v, v != nil
}

func (l *stubLedger) PutState(key string, value []byte) {
	l.record(l.stub.PutState(key, value))
}

func (l *stubLedger) DelState(key string) {
	l.record(l.stub.DelState(key))
}
