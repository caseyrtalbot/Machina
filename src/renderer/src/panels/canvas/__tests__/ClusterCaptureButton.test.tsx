import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ClusterCaptureButton } from '../ClusterCaptureButton'

describe('ClusterCaptureButton', () => {
  it('renders the "Keep as note" control when cluster_id is present and there are members', () => {
    const onClick = vi.fn()
    const { getByText } = render(
      <ClusterCaptureButton clusterId="cl-1" hasMembers={true} onCapture={onClick} />
    )
    fireEvent.click(getByText(/keep as note/i))
    expect(onClick).toHaveBeenCalled()
  })

  it('does not render when cluster_id is missing', () => {
    const { queryByText } = render(
      <ClusterCaptureButton clusterId={null} hasMembers={false} onCapture={() => {}} />
    )
    expect(queryByText(/keep as note/i)).toBeNull()
  })

  it('does not render when hasMembers is false', () => {
    const { queryByText } = render(
      <ClusterCaptureButton clusterId="cl-1" hasMembers={false} onCapture={() => {}} />
    )
    expect(queryByText(/keep as note/i)).toBeNull()
  })
})
