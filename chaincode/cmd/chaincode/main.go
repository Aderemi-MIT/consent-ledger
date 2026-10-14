// Command chaincode is the Hyperledger Fabric entrypoint for the
// consentaccess smart contract. It is the package to point
// `peer lifecycle chaincode package --path` at.
package main

import (
	"log"

	consentaccess "consentaccess"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func main() {
	cc, err := contractapi.NewChaincode(&consentaccess.SmartContract{})
	if err != nil {
		log.Panicf("creating consentaccess chaincode: %v", err)
	}
	if err := cc.Start(); err != nil {
		log.Panicf("starting consentaccess chaincode: %v", err)
	}
}
