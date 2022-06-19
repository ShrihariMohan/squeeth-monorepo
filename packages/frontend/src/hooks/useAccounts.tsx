import { useQuery } from '@apollo/client'
import { ACCOUNTS_QUERY } from '@queries/squeeth/accountsQuery'
import {
  accounts,
  accountsVariables,
  accounts_accounts_positions,
  accounts_accounts_lppositions,
} from '@queries/squeeth/__generated__/accounts'
import { squeethClient } from '@utils/apollo-client'
import BigNumber from 'bignumber.js'
import { useAtom, useAtomValue } from 'jotai'
import { accountAtom } from 'src/state/positions/atoms'
import { addressAtom, networkIdAtom } from 'src/state/wallet/atoms'
import { PositionType } from 'src/types'
import useAppEffect from './useAppEffect'

const initPosition = {
  currentOSQTHAmount: new BigNumber(0),
  currentETHAmount: new BigNumber(0),
  unrealizedOSQTHUnitCost: new BigNumber(0),
  unrealizedETHUnitCost: new BigNumber(0),
  realizedOSQTHUnitCost: new BigNumber(0),
  realizedETHUnitCost: new BigNumber(0),
  realizedOSQTHUnitGain: new BigNumber(0),
  realizedETHUnitGain: new BigNumber(0),
  realizedOSQTHAmount: new BigNumber(0),
  realizedETHAmount: new BigNumber(0),
}

export default function useAccounts() {
  const address = useAtomValue(addressAtom)
  const networkId = useAtomValue(networkIdAtom)
  const [account, setAccount] = useAtom(accountAtom)

  const { data, loading, refetch } = useQuery<accounts, accountsVariables>(ACCOUNTS_QUERY, {
    variables: { ownerId: address! },
    client: squeethClient[networkId],
    skip: !address,
  })

  useAppEffect(() => {
    setAccount(data?.accounts)
  }, [data?.accounts, setAccount])


  return {
    accShortAmount: account ? account[0]?.accShortAmount : new BigNumber(0),
    positions: (account ? account[0]?.positions[0] : initPosition) as accounts_accounts_positions,
    lpPositions: (account ? account[0]?.lppositions[0] : initPosition) as accounts_accounts_lppositions,
    loading,
    refetch,
  }
}
