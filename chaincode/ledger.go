package consentaccess

import "sync"

// Ledger is a minimal stand-in for the subset of the Hyperledger Fabric
// ChaincodeStubInterface this chaincode actually uses (GetState / PutState /
// DelState). In a deployed Fabric network, the real chaincode shim provides
// this interface backed by the peer's world state (LevelDB/CouchDB) and
// transaction context. Here it is backed by a plain in-memory map so the
// chaincode logic below can be unit-tested independently of a running
// Fabric network, which this environment cannot provision (no Docker
// daemon available). Swapping MockLedger for the real
// shim.ChaincodeStubInterface at deployment time requires no change to the
// functions in chaincode.go, since they are written only against the
// Ledger interface.
type Ledger interface {
	GetState(key string) ([]byte, bool)
	PutState(key string, value []byte)
	DelState(key string)
}

// MockLedger is an in-memory implementation of Ledger used for unit and
// functional testing of the chaincode logic.
type MockLedger struct {
	mu    sync.Mutex
	state map[string][]byte
}

func NewMockLedger() *MockLedger {
	return &MockLedger{state: make(map[string][]byte)}
}

func (l *MockLedger) GetState(key string) ([]byte, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	v, ok := l.state[key]
	return v, ok
}

func (l *MockLedger) PutState(key string, value []byte) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.state[key] = value
}

func (l *MockLedger) DelState(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.state, key)
}
